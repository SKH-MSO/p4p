// P4P Admin — LINE ↔ email binding lookup.
// Reads from GET /admin/api/line-bindings (same-origin, Basic-Auth gated by
// main.js's requireAdmin — see scripts/bind-line-user.sql for the table).
;(function () {
    const searchInput = document.getElementById("search")
    const refreshBtn  = document.getElementById("refresh")
    const stateEl     = document.getElementById("state")
    const tableEl     = document.getElementById("table")
    const rowsEl      = document.getElementById("rows")
    const countEl     = document.getElementById("count")

    let bindings = []

    const fmtDate = (iso) => {
        if (!iso) return "—"
        try {
            return new Date(iso).toLocaleString("en-GB", {
                year: "numeric", month: "short", day: "2-digit",
                hour: "2-digit", minute: "2-digit",
            })
        } catch { return iso }
    }

    function render() {
        const q = searchInput.value.trim().toLowerCase()
        const filtered = q
            ? bindings.filter((b) =>
                (b.email || "").toLowerCase().includes(q) ||
                (b.line_display_name || "").toLowerCase().includes(q) ||
                (b.line_user_id || "").toLowerCase().includes(q))
            : bindings

        rowsEl.textContent = ""
        for (const b of filtered) {
            const tr = document.createElement("tr")

            const cells = [
                ["Email", b.email || "—"],
                ["LINE Display Name", b.line_display_name || "—"],
                ["LINE User ID", b.line_user_id || "—"],
                ["Bound At", fmtDate(b.bound_at)],
            ]
            for (const [label, value] of cells) {
                const td = document.createElement("td")
                td.dataset.label = label
                if (label === "LINE User ID") td.className = "mono"
                if (value === "—") td.className = (td.className ? td.className + " " : "") + "muted"
                td.textContent = value
                tr.appendChild(td)
            }
            rowsEl.appendChild(tr)
        }

        countEl.textContent = q
            ? `${filtered.length} of ${bindings.length} binding(s)`
            : `${bindings.length} binding(s)`
    }

    async function load() {
        stateEl.textContent = "Loading…"
        stateEl.className = ""
        stateEl.classList.remove("hidden")
        tableEl.classList.add("hidden")
        refreshBtn.disabled = true
        try {
            const resp = await fetch("/admin/api/line-bindings")
            if (!resp.ok) throw new Error("HTTP " + resp.status)
            bindings = await resp.json()
            stateEl.classList.add("hidden")
            tableEl.classList.remove("hidden")
            render()
        } catch (err) {
            console.error(err)
            stateEl.textContent = "Failed to load bindings. " + err.message
            stateEl.className = "error"
        } finally {
            refreshBtn.disabled = false
        }
    }

    searchInput.addEventListener("input", render)
    refreshBtn.addEventListener("click", load)
    load()
})()
