;(function () {
    "use strict"

    // ── Mobile-only gate ─────────────────────────────────────────────────
    const desktopBlock = document.getElementById("desktop-block")
    if (!/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        desktopBlock.style.display = "flex"
        return
    }

    // ── DOM refs ─────────────────────────────────────────────────────────
    const load          = document.getElementById("load")
    const unauthorized  = document.getElementById("unauthorized")
    const appEl         = document.getElementById("app")
    const logoutBtn     = document.getElementById("logout-btn")
    const tableSelect   = document.getElementById("table_select")
    const addBtn        = document.getElementById("add-btn")
    const rowCount      = document.getElementById("row-count")
    const rowsEl        = document.getElementById("rows")
    const newRowCard    = document.getElementById("new-row-card")
    const statusMsg     = document.getElementById("status_msg")

    let columns = []   // [{column_name, data_type, is_pk}]
    let currentTable = null

    // ── Helpers ──────────────────────────────────────────────────────────
    function escHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
    }

    function showStatus(text, isError) {
        statusMsg.textContent = text
        statusMsg.className = isError ? "error" : "ok"
        if (text) setTimeout(() => { statusMsg.className = "hidden" }, 3500)
        else statusMsg.className = "hidden"
    }

    async function api(path, opts) {
        const resp = await fetch(path, Object.assign({ credentials: "same-origin" }, opts))
        if (resp.status === 401) {
            appEl.classList.add("hidden")
            unauthorized.classList.remove("hidden")
            throw new Error("unauthorized")
        }
        const body = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(body.error || ("request failed: " + resp.status))
        return body
    }

    // Current Thai-calendar (Buddhist year) YYYY_MM, same arithmetic as
    // main.js's createStatusSublist (Gregorian year + 543).
    function currentRosterTableName() {
        const now = new Date()
        const year = now.getFullYear() + 543
        const month = String(now.getMonth() + 1).padStart(2, "0")
        return year + "_" + month
    }

    function isTimestampType(dataType) {
        return /timestamp/i.test(dataType || "")
    }
    function isNumericType(dataType) {
        return /double precision|numeric|integer|real|bigint/i.test(dataType || "")
    }

    // Editable columns only (skip the uuid PK, e.g. "index").
    function editableColumns() {
        return columns.filter((c) => !c.is_pk)
    }

    function inputTypeFor(col) {
        if (isTimestampType(col.data_type)) return "datetime-local"
        if (isNumericType(col.data_type)) return "number"
        return "text"
    }

    // "2026-08-08T10:00:00+00:00" -> "2026-08-08T10:00" (for <input datetime-local>)
    function toLocalInputValue(iso) {
        if (!iso) return ""
        const d = new Date(iso)
        if (isNaN(d.getTime())) return ""
        const pad = (n) => String(n).padStart(2, "0")
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
            "T" + pad(d.getHours()) + ":" + pad(d.getMinutes())
    }

    // ── Table select ─────────────────────────────────────────────────────
    async function loadTables() {
        const { tables } = await api("/admin/api/tables")
        tableSelect.innerHTML = ""
        for (const t of tables) {
            const opt = document.createElement("option")
            opt.value = t
            opt.textContent = t
            tableSelect.appendChild(opt)
        }
        const preferred = currentRosterTableName()
        tableSelect.value = tables.includes(preferred) ? preferred : (tables[tables.length - 1] || "")
        return tableSelect.value
    }

    // ── Rows rendering ───────────────────────────────────────────────────
    function fieldLineHtml(col, value, editing) {
        const label = escHtml(col.column_name)
        if (!editing) {
            let display = value
            if (isTimestampType(col.data_type) && value) {
                const d = new Date(value)
                display = isNaN(d.getTime()) ? value : d.toLocaleString("th-TH")
            }
            return '<div class="field-line"><div class="field-label">' + label + '</div>' +
                '<div class="field-value">' + (display == null || display === "" ? "<span style=\"color:var(--border)\">—</span>" : escHtml(display)) + "</div></div>"
        }
        const type = inputTypeFor(col)
        const inputValue = type === "datetime-local" ? toLocalInputValue(value) : (value == null ? "" : value)
        return '<div class="field-line"><div class="field-label">' + label + '</div>' +
            '<input data-col="' + escHtml(col.column_name) + '" type="' + type + '" ' +
            (type === "number" ? 'step="any" ' : "") +
            'value="' + escHtml(inputValue) + '"></div>'
    }

    function collectInputValues(card) {
        const out = {}
        card.querySelectorAll("input[data-col]").forEach((input) => {
            const col = columns.find((c) => c.column_name === input.dataset.col)
            let v = input.value
            if (v === "") { out[input.dataset.col] = null; return }
            if (col && isNumericType(col.data_type)) v = Number(v)
            if (col && isTimestampType(col.data_type)) v = new Date(v).toISOString()
            out[input.dataset.col] = v
        })
        return out
    }

    function renderRowCard(row) {
        const card = document.createElement("div")
        card.className = "row-card"
        const pk = columns.find((c) => c.is_pk)
        const pkValue = pk ? row[pk.column_name] : null

        function renderView() {
            card.classList.remove("editing")
            card.innerHTML = editableColumns().map((c) => fieldLineHtml(c, row[c.column_name], false)).join("") +
                '<div class="row-actions">' +
                '<button type="button" class="row-btn btn-delete">ลบ</button>' +
                '<button type="button" class="row-btn btn-edit">แก้ไข</button>' +
                "</div>"
            card.querySelector(".btn-edit").addEventListener("click", renderEdit)
            card.querySelector(".btn-delete").addEventListener("click", async () => {
                if (!confirm("ยืนยันการลบแถวนี้?")) return
                try {
                    await api("/admin/api/tables/" + encodeURIComponent(currentTable) + "/rows/" + encodeURIComponent(pkValue), { method: "DELETE" })
                    card.remove()
                    showStatus("ลบแล้ว", false)
                    updateRowCount(-1)
                } catch (e) {
                    showStatus("ลบไม่สำเร็จ: " + e.message, true)
                }
            })
        }

        function renderEdit() {
            card.classList.add("editing")
            card.innerHTML = editableColumns().map((c) => fieldLineHtml(c, row[c.column_name], true)).join("") +
                '<div class="row-actions">' +
                '<button type="button" class="row-btn btn-cancel">ยกเลิก</button>' +
                '<button type="button" class="row-btn btn-save">บันทึก</button>' +
                "</div>"
            card.querySelector(".btn-cancel").addEventListener("click", renderView)
            card.querySelector(".btn-save").addEventListener("click", async () => {
                const body = collectInputValues(card)
                try {
                    const { row: updated } = await api(
                        "/admin/api/tables/" + encodeURIComponent(currentTable) + "/rows/" + encodeURIComponent(pkValue),
                        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
                    )
                    Object.assign(row, updated || body)
                    renderView()
                    showStatus("บันทึกแล้ว", false)
                } catch (e) {
                    showStatus("บันทึกไม่สำเร็จ: " + e.message, true)
                }
            })
        }

        renderView()
        return card
    }

    function updateRowCount(delta) {
        const n = rowsEl.children.length + (delta || 0)
        rowCount.textContent = n + " แถว"
    }

    async function loadRowsAndColumns(table) {
        rowsEl.innerHTML = ""
        newRowCard.style.display = "none"
        load.style.display = "block"
        try {
            const [{ columns: cols }, { rows }] = await Promise.all([
                api("/admin/api/tables/" + encodeURIComponent(table) + "/columns"),
                api("/admin/api/tables/" + encodeURIComponent(table) + "/rows"),
            ])
            columns = cols
            for (const row of rows) rowsEl.appendChild(renderRowCard(row))
            rowCount.textContent = rows.length + " แถว"
        } catch (e) {
            if (e.message !== "unauthorized") showStatus("โหลดข้อมูลไม่สำเร็จ: " + e.message, true)
        } finally {
            load.style.display = "none"
        }
    }

    // ── Add row ──────────────────────────────────────────────────────────
    function openAddForm() {
        newRowCard.style.display = "block"
        newRowCard.innerHTML = editableColumns().map((c) => fieldLineHtml(c, null, true)).join("") +
            '<div class="row-actions">' +
            '<button type="button" class="row-btn btn-cancel">ยกเลิก</button>' +
            '<button type="button" class="row-btn btn-save">เพิ่ม</button>' +
            "</div>"
        newRowCard.querySelector(".btn-cancel").addEventListener("click", () => {
            newRowCard.style.display = "none"
            newRowCard.innerHTML = ""
        })
        newRowCard.querySelector(".btn-save").addEventListener("click", async () => {
            const body = collectInputValues(newRowCard)
            try {
                const { row } = await api(
                    "/admin/api/tables/" + encodeURIComponent(currentTable) + "/rows",
                    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
                )
                if (row) rowsEl.insertBefore(renderRowCard(row), rowsEl.firstChild)
                newRowCard.style.display = "none"
                newRowCard.innerHTML = ""
                showStatus("เพิ่มแถวแล้ว", false)
                updateRowCount(1)
            } catch (e) {
                showStatus("เพิ่มแถวไม่สำเร็จ: " + e.message, true)
            }
        })
    }
    addBtn.addEventListener("click", openAddForm)

    tableSelect.addEventListener("change", () => {
        currentTable = tableSelect.value
        loadRowsAndColumns(currentTable)
    })

    logoutBtn.addEventListener("click", async () => {
        await fetch("/admin/logout", { method: "POST", credentials: "same-origin" }).catch(() => {})
        location.reload()
    })

    // ── Boot ─────────────────────────────────────────────────────────────
    ;(async function main() {
        load.style.display = "block"
        try {
            currentTable = await loadTables()
            appEl.classList.remove("hidden")
            unauthorized.classList.add("hidden")
            if (currentTable) await loadRowsAndColumns(currentTable)
        } catch (e) {
            if (e.message !== "unauthorized") showStatus("โหลดไม่สำเร็จ: " + e.message, true)
        } finally {
            load.style.display = "none"
        }
    })()
})()
