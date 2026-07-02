      ;(function () {
        // ── LINE-only guard ───────────────────────────────────────────────────
        // The data pages (status/list/ranking) only work inside the LINE app, so
        // there's no point asking a desktop/Chrome visitor to verify. Show the
        // same "open via LINE" block those pages use and stop here.
        const desktopBlock = document.getElementById("desktop-block")
        if (!/Line\//i.test(navigator.userAgent)) {
            if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                desktopBlock.querySelector("h2").textContent = "กรุณาเปิดผ่าน LINE application"
                desktopBlock.querySelector("p").textContent  = "ขอบคุณสำหรับความร่วมมือ"
            }
            desktopBlock.style.display = "flex"
            return
        }

        const db = supabase.createClient(P4P.SUPABASE_URL, P4P.SUPABASE_KEY)

        // ── Return target (open-redirect safe) ────────────────────────────────
        // Only accept same-origin paths: a single leading "/" that is not "//"
        // or "/\" (protocol-relative). Anything else falls back to /status/.
        function safeReturn() {
            const raw = new URLSearchParams(location.search).get("return") || ""
            const dec = (() => { try { return decodeURIComponent(raw) } catch { return "" } })()
            if (/^\/(?![/\\])/.test(dec)) return dec
            return "/status/"
        }
        const RETURN_TO = safeReturn()

        // ── DOM refs ──────────────────────────────────────────────────────────
        const emailStep   = document.getElementById("email-step")
        const codeStep    = document.getElementById("code-step")
        const emailInput  = document.getElementById("email")
        const codeInput   = document.getElementById("code")
        const emailSubmit = document.getElementById("email-submit")
        const codeSubmit  = document.getElementById("code-submit")
        const backBtn     = document.getElementById("back-btn")
        const sentTo      = document.getElementById("sent-to")
        const msg         = document.getElementById("msg")

        let currentEmail = ""

        // ── Helpers ───────────────────────────────────────────────────────────
        const showError = (text) => { msg.className = "msg error"; msg.textContent = text }
        const showOk    = (text) => { msg.className = "msg ok";    msg.textContent = text }
        const clearMsg  = ()     => { msg.className = "msg";       msg.textContent = "" }
        const busy = (btn, on, label) => {
            btn.disabled = on
            btn.innerHTML = on ? '<span class="spinner"></span>' + label : label
        }

        // ── Pending-email persistence ─────────────────────────────────────────
        // To read the OTP the user must leave LINE for their email app and come
        // back. If the in-app browser reloads the page during that round-trip,
        // restore the code-entry step instead of dropping them at step 1.
        const PENDING_KEY = "p4p_verify_pending"
        const PENDING_TTL = 15 * 60 * 1000 // 15 min — after this the OTP is likely dead
        const savePending  = (email) => {
            try { localStorage.setItem(PENDING_KEY, JSON.stringify({ email, ts: Date.now() })) } catch (e) { /* storage blocked */ }
        }
        const clearPending = () => {
            try { localStorage.removeItem(PENDING_KEY) } catch (e) { /* storage blocked */ }
        }
        const readPending  = () => {
            try {
                const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null")
                if (p && p.email && Date.now() - p.ts < PENDING_TTL) return p.email
            } catch (e) { /* ignore */ }
            clearPending()
            return null
        }

        // Switch to the code-entry step for a given email (after sending, or on
        // restore after a reload).
        const goToCodeStep = (email) => {
            currentEmail = email
            sentTo.textContent = email
            emailStep.classList.add("hidden")
            codeStep.classList.remove("hidden")
            codeInput.focus()
        }

        // Already verified? Skip straight to the page they wanted. Otherwise, if a
        // verification was in progress before a reload, restore the code step.
        db.auth.getSession().then(({ data }) => {
            if (data.session) { location.replace(RETURN_TO); return }
            const pendingEmail = readPending()
            if (pendingEmail) {
                goToCodeStep(pendingEmail)
                showOk("กรุณากรอกรหัสยืนยันที่ส่งไปยังอีเมลของท่าน")
            }
        })

        // ── Step 1 — request an OTP ───────────────────────────────────────────
        emailStep.addEventListener("submit", async (e) => {
            e.preventDefault()
            clearMsg()
            const email = emailInput.value.trim().toLowerCase()
            if (!email) return
            busy(emailSubmit, true, "กำลังส่ง...")
            try {
                // Only allow-listed physicians (in physician_directory or
                // sender_physician_match) may proceed. Checked via a SECURITY
                // DEFINER RPC that returns just a boolean, so the email list is
                // never exposed.
                const { data: allowed, error: rpcErr } =
                    await db.rpc("is_sender_allowlisted", { p_email: email })
                if (rpcErr) throw rpcErr
                if (!allowed) {
                    // Not on the list yet — log the attempt so an admin can add
                    // this physician to the directory, and tell them it's pending.
                    await db.rpc("log_access_request", { p_email: email })
                    busy(emailSubmit, false, "ส่งรหัสยืนยัน")
                    showError("อีเมลนี้ยังไม่ได้ลงทะเบียน ระบบได้บันทึกคำขอแล้ว ผู้ดูแลจะเพิ่มให้ท่านเร็ว ๆ นี้")
                    return
                }

                const { error } = await db.auth.signInWithOtp({
                    email,
                    options: { shouldCreateUser: true },
                })
                if (error) throw error

                savePending(email)      // survive an in-app-browser reload
                goToCodeStep(email)
                busy(emailSubmit, false, "ส่งรหัสยืนยัน")
                showOk("ส่งรหัสยืนยันแล้ว กรุณาตรวจสอบอีเมลของท่าน")
            } catch (err) {
                console.error(err)
                busy(emailSubmit, false, "ส่งรหัสยืนยัน")
                showError("ส่งรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
            }
        })

        // ── Step 2 — verify the OTP ───────────────────────────────────────────
        codeStep.addEventListener("submit", async (e) => {
            e.preventDefault()
            clearMsg()
            const token = codeInput.value.trim()
            if (!/^[0-9]{6}$/.test(token)) {
                showError("กรุณากรอกรหัส 6 หลัก")
                return
            }
            busy(codeSubmit, true, "กำลังยืนยัน...")
            try {
                const { error } = await db.auth.verifyOtp({
                    email: currentEmail,
                    token,
                    type: "email",
                })
                if (error) throw error
                clearPending()
                showOk("ยืนยันสำเร็จ กำลังนำท่านเข้าสู่ระบบ...")
                location.replace(RETURN_TO)
            } catch (err) {
                console.error(err)
                busy(codeSubmit, false, "ยืนยัน")
                showError("รหัสไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่")
            }
        })

        // ── Back to email step ────────────────────────────────────────────────
        backBtn.addEventListener("click", () => {
            clearPending()
            clearMsg()
            codeStep.classList.add("hidden")
            emailStep.classList.remove("hidden")
            codeInput.value = ""
            emailInput.focus()
        })
      })()
