        // ── Supabase (client + verification gate from /assets/auth-guard.js) ──
        const db = P4P.db

        // Inline status icons (replaces FontAwesome, so CSP needs no external
        // script). stroke=currentColor so the .icon-notset color rule applies.
        const CHECK_SVG = '<svg class="stat-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
        const XMARK_SVG = '<svg class="stat-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'

        // ── URL params ────────────────────────────────────────────────────────
        // LIFF often nests an already percent-encoded querystring inside
        // liff.state (e.g. "?liff.state=%3Fsheetname%3D2569_07"). A stray "%"
        // that isn't a valid escape sequence makes decodeURIComponent throw
        // URIError — this runs at module top level, outside main()'s
        // try/catch, so an uncaught throw here used to leave the page stuck
        // on the loading skeleton forever with no visible error.
        let queryString
        try {
            queryString = decodeURIComponent(window.location.search).replace("?liff.state=", "")
        } catch (e) {
            console.warn("Failed to decode location.search:", e)
            queryString = window.location.search.replace("?liff.state=", "")
        }
        const par_sheetname = new URLSearchParams(queryString).get("sheetname")

        // ── DOM refs ──────────────────────────────────────────────────────────
        const header         = document.getElementById("header")
        const header_count   = document.getElementById("header_count")
        const header_display = document.getElementById("header_display")
        const header_search  = document.getElementById("header_search")
        const header_note    = document.getElementById("header_note")
        const byname_input   = document.getElementById("byname_input")
        const byname_label   = document.getElementById("byname_label")
        const bydep_input    = document.getElementById("bydep_input")
        const bydep_label    = document.getElementById("bydep_label")
        const content        = document.getElementById("content")
        const load           = document.getElementById("load")
        const pending        = document.getElementById("pending")
        const sent           = document.getElementById("sent")
        const searchable     = document.getElementById("searchable")
        const tbody_pending  = document.getElementById("tbody_pending")
        const tbody_sent     = document.getElementById("tbody_sent")
        const tbody_searchable = document.getElementById("tbody_searchable")
        const backtotop      = document.getElementById("backtotop")
        const desktopBlock   = document.getElementById("desktop-block")

        // ── Constants ─────────────────────────────────────────────────────────
        const dep_array = ["กุมารเวชกรรม", "จักษุวิทยา", "จิตเวชและยาเสพติด", "เทคนิคการแพทย์และพยาธิวิทยาคลินิก", "นิติเวช", "ผู้ป่วยนอก", "พยาธิวิทยากายวิภาค", "รังสีวิทยา", "วิสัญญีวิทยา", "เวชกรรมฟื้นฟู", "เวชกรรมสังคม", "เวชศาสตร์ฉุกเฉิน", "ศัลยกรรม", "ศัลยกรรมออร์โธปิดิกส์", "สูติ-นรีเวชกรรม", "โสต ศอ นาสิก", "อาชีวเวชกรรม", "อายุรกรรม", "INTERN"]
        const color_array = P4P.COLOR_ARRAY

        // arr row: [fullname, fullname, department, isSent (bool)]
        // arr[0] = arr[1] = fullname  |  arr[2] = department  |  arr[3] = sent status
        let count_true = 0
        let arr = []

        // ── Helpers ───────────────────────────────────────────────────────────
        const displaying = (param) => {
            const month_names = P4P.THAI_MONTHS
            const year  = param.slice(0, 4)
            const month = parseInt(param.slice(5))
            return month_names[month - 1] + " " + year
        }

        const scrolling = () => {
            if (document.body.scrollTop > 20 || document.documentElement.scrollTop > 20) {
                backtotop.classList.remove("hidden")
            } else {
                backtotop.classList.add("hidden")
            }
        }

        const topping = () => { window.scrollTo({ top: 0, behavior: "smooth" }) }

        // Build a searchable row (used by fulling & parting)
        const makeSearchRow = (entry) => {
            const tr      = document.createElement("tr")
            const td_name = document.createElement("td")
            td_name.classList.add("search-name")
            td_name.innerText = entry[1]                // fullname
            const td_status = document.createElement("td")
            td_status.classList.add("search-status")
            const icon = document.createElement("span")
            if (entry[3]) {
                icon.innerHTML = CHECK_SVG
            } else {
                icon.classList.add("icon-notset")
                icon.innerHTML = XMARK_SVG
                td_name.classList.add("not-sent")
            }
            td_status.appendChild(icon)
            tr.appendChild(td_name)
            tr.appendChild(td_status)
            return tr
        }

        // Render grouped (by department) rows into tbody_searchable
        const renderGrouped = (data) => {
            if (data.length === 0) { searchable.style.display = "none"; return }
            for (let i = 0; i < dep_array.length; i++) {
                const depEntries = data
                    .filter(e => e[2] === dep_array[i])
                    .sort((a, b) => a[1].localeCompare(b[1], "th"))
                if (depEntries.length === 0) continue
                const tr_h = document.createElement("tr")
                tr_h.classList.add("dep-header")
                const td_h = document.createElement("td")
                td_h.colSpan = 2
                td_h.innerText = dep_array[i] === "INTERN" ? "INTERN" : "กลุ่มงาน" + dep_array[i]
                tr_h.appendChild(td_h)
                tbody_searchable.appendChild(tr_h)
                for (const entry of depEntries) {
                    tbody_searchable.appendChild(makeSearchRow(entry))
                }
            }
        }

        // ── Event listeners ───────────────────────────────────────────────────
        window.addEventListener("scroll", scrolling)
        backtotop.addEventListener("click", topping)

        byname_input.addEventListener("change", function () {
            pending.style.display = "block"
            sent.style.display    = "block"
            searchable.style.display = "none"
            topping()
            bydep_input.checked  = !this.checked
            header_search.value  = ""
        })

        bydep_input.addEventListener("change", function () {
            pending.style.display = "block"
            sent.style.display    = "block"
            searchable.style.display = "none"
            topping()
            byname_input.checked = !this.checked
            header_search.value  = ""
        })

        header_search.addEventListener("focus", function () {
            pending.style.display    = "block"
            sent.style.display       = "block"
            searchable.style.display = "none"
            this.value = ""
        })

        header_search.addEventListener("input", function () {
            while (tbody_searchable.firstChild) {
                tbody_searchable.removeChild(tbody_searchable.lastChild)
            }
            if (this.value === "") {
                pending.style.display    = "block"
                sent.style.display       = "block"
                searchable.style.display = "none"
                return
            }
            pending.style.display    = "none"
            sent.style.display       = "none"
            searchable.style.display = "block"
            if (/^[ ]+$/.test(this.value)) {
                renderGrouped(arr)
            } else if (byname_input.checked) {
                renderGrouped(arr.filter((e) => e[1].toLowerCase().includes(this.value.trim().toLowerCase())))
            } else if (bydep_input.checked) {
                renderGrouped(arr.filter((e) => e[2].toLowerCase().includes(this.value.trim().toLowerCase())))
            }
        })

        // ── Main ──────────────────────────────────────────────────────────────
        const main = async () => {
            if (!/Line\//i.test(navigator.userAgent)) {
                if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                    desktopBlock.querySelector("h2").textContent = "กรุณาเปิดผ่าน LINE application"
                    desktopBlock.querySelector("p").textContent  = "ขอบคุณสำหรับความร่วมมือ"
                }
                desktopBlock.style.display = "flex"
                return
            }

            if (!par_sheetname) {
                header.style.display     = "flex"
                content.style.display    = "flex"
                load.style.display       = "none"
                header_display.innerText = "ไม่พบพารามิเตอร์"
                header_display.classList.remove("skeleton")
                header_count.innerText   = ""
                header_count.classList.remove("skeleton")
                return
            }

            header.style.display  = "flex"
            content.style.display = "flex"

            try {
                // 1. Fetch roster + submission timestamps from the month table
                const supaResp = await db.from(par_sheetname)
                    .select("firstname, lastname, department, submitted_at")

                if (supaResp.error) throw new Error("Supabase: " + supaResp.error.message)

                const referenceRows = supaResp.data                     // rows from the month table

                // 2. Style header
                const month      = parseInt(par_sheetname.slice(5))
                const monthColor = color_array[month - 1][1]
                header_display.style.background = monthColor
                header_display.style.color      = "#2d2d2d"
                pending.querySelector("summary").style.background = "#4B3D33"
                pending.querySelector("summary").style.color      = "#fff"
                header_display.innerText = displaying(par_sheetname)
                header_display.classList.remove("skeleton")
                header_count.classList.remove("skeleton")
                header_search.disabled = false
                header_note.classList.add("active")
                byname_input.disabled  = false
                byname_input.checked   = true
                byname_label.classList.add("active")
                bydep_input.disabled   = false
                bydep_label.classList.add("active")
                load.style.display     = "none"
                pending.style.display  = "block"
                sent.style.display     = "block"

                // 3. Build arr, compare, render rows
                const pendingEntries = []
                const sentEntries    = []

                for (let i = 0; i < referenceRows.length; i++) {
                    const row        = referenceRows[i]
                    // null-safe join — avoids rendering "สมชาย null" when a name
                    // column is missing (matches ranking/list pages' pattern)
                    const fullname   = [row.firstname, row.lastname].filter(Boolean).join(" ")
                    const department = row.department || ""
                    const isSent     = row.submitted_at != null

                    arr[i] = [fullname, fullname, department, isSent]

                    if (isSent) {
                        sentEntries.push({ fullname, department })
                        count_true++
                    } else {
                        pendingEntries.push({ fullname, department })
                    }
                }

                pendingEntries.sort((a, b) => a.fullname.localeCompare(b.fullname, "th"))
                sentEntries.sort((a, b) => a.fullname.localeCompare(b.fullname, "th"))

                const makeRow = (fullname, department, isSent) => {
                    const tr      = document.createElement("tr")
                    const td_name = document.createElement("td")
                    td_name.classList.add("td-name")
                    const div = document.createElement("div")
                    const p1  = document.createElement("p")
                    p1.innerText = fullname
                    p1.classList.add("name-main")
                    const p2 = document.createElement("p")
                    p2.innerText = department
                    p2.classList.add("name-sub")
                    div.appendChild(p1)
                    div.appendChild(p2)
                    td_name.appendChild(div)
                    tr.appendChild(td_name)
                    const td_status = document.createElement("td")
                    td_status.classList.add("td-status")
                    const icon = document.createElement("span")
                    if (isSent) {
                        icon.innerHTML = CHECK_SVG
                    } else {
                        icon.classList.add("icon-notset")
                        icon.innerHTML = XMARK_SVG
                        td_name.classList.add("not-sent")
                    }
                    td_status.appendChild(icon)
                    tr.appendChild(td_status)
                    return tr
                }

                for (const e of pendingEntries) tbody_pending.appendChild(makeRow(e.fullname, e.department, false))
                for (const e of sentEntries)    tbody_sent.appendChild(makeRow(e.fullname, e.department, true))

                header_count.innerText = "(ส่ง " + count_true + " จาก " + referenceRows.length + " ราย)"

            } catch (err) {
                console.error(err)
                load.style.display       = "none"
                header_display.innerText = "เกิดข้อผิดพลาด"
                header_display.classList.remove("skeleton")
                header_count.innerText   = ""
                header_count.classList.remove("skeleton")
            }
        }

        // Only load data once the verification gate confirms a valid session
        // (P4P.ready never resolves when unverified — it redirects to /verify/).
        P4P.ready.then(() => main())
