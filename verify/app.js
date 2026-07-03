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

        const db = supabase.createClient(P4P.SUPABASE_URL, P4P.SUPABASE_KEY, P4P.SUPABASE_OPTS)

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
        const requestStep = document.getElementById("request-step")
        const reqName     = document.getElementById("reqname")
        const reqEmail    = document.getElementById("req-email")
        const requestSubmit = document.getElementById("request-submit")
        const requestBack = document.getElementById("request-back")
        const msg         = document.getElementById("msg")

        let currentEmail = ""

        // ── Helpers ───────────────────────────────────────────────────────────
        const showError  = (text) => { msg.className = "msg error";  msg.textContent = text }
        const showOk     = (text) => { msg.className = "msg ok";     msg.textContent = text }
        const showNotice = (text) => { msg.className = "msg notice"; msg.textContent = text }
        const clearMsg   = ()     => { msg.className = "msg";        msg.textContent = "" }
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

        // Why did the server send us here? "expired" = the session lapsed;
        // "no_session" is the everyday logged-out case and stays silent.
        const bounceReason = new URLSearchParams(location.search).get("reason")
        const reasonShown = bounceReason === "expired"
        if (bounceReason === "expired") {
            showNotice("เซสชันหมดอายุ กรุณายืนยันตัวตนอีกครั้ง")
        }

        // If a verification was in progress before a reload, restore the code step.
        const pendingEmail = readPending()
        if (pendingEmail) {
            goToCodeStep(pendingEmail)
            if (!reasonShown) showOk("กรุณากรอกรหัสยืนยันที่ส่งไปยังอีเมลของท่าน")
        }

        // ── Step 1 — request an OTP ───────────────────────────────────────────
        emailStep.addEventListener("submit", async (e) => {
            e.preventDefault()
            clearMsg()
            const email = emailInput.value.trim().toLowerCase()
            if (!email) return
            // Email-format check before hitting the server.
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showError("กรุณากรอกอีเมลให้ถูกต้อง")
                return
            }
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
                    // Not on the list yet — ask for their name so an admin can
                    // identify and add them, then log the request (see request-step).
                    currentEmail = email
                    reqEmail.textContent = email
                    busy(emailSubmit, false, "ส่งรหัสยืนยัน")
                    clearMsg()
                    emailStep.classList.add("hidden")
                    requestStep.classList.remove("hidden")
                    reqName.focus()
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

        // Keep the OTP field to digits only (max 6) — strips anything pasted or
        // typed that isn't 0-9, so the field can only ever hold a valid code.
        codeInput.addEventListener("input", () => {
            const cleaned = codeInput.value.replace(/\D/g, "").slice(0, 6)
            if (cleaned !== codeInput.value) codeInput.value = cleaned
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
                const { data, error } = await db.auth.verifyOtp({
                    email: currentEmail,
                    token,
                    type: "email",
                })
                if (error) throw error
                if (!data.session) throw new Error("verifyOtp returned no session")
                clearPending()

                // Hand the tokens to the SERVER, which stores the refresh token in
                // an HttpOnly cookie and validates every page request. The browser
                // never persists a session itself (unreliable in LINE's webview).
                const resp = await fetch("/auth/session", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        access_token: data.session.access_token,
                        refresh_token: data.session.refresh_token,
                    }),
                })
                if (!resp.ok) throw new Error("session POST failed: " + resp.status)

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

        // ── Step 2b — submit an access request (name + email) ─────────────────
        requestStep.addEventListener("submit", async (e) => {
            e.preventDefault()
            clearMsg()
            const name = reqName.value.trim()
            if (name.length < 2) {
                showError("กรุณากรอกชื่อ-นามสกุลของท่าน")
                return
            }
            busy(requestSubmit, true, "กำลังส่ง...")
            try {
                await db.rpc("log_access_request", { p_email: currentEmail, p_name: name })
                requestStep.classList.add("hidden")
                showNotice("ส่งคำขอเรียบร้อยแล้ว ผู้ดูแลจะเพิ่มสิทธิ์ให้ท่านเร็ว ๆ นี้ กรุณากลับมายืนยันอีกครั้งภายหลัง")
            } catch (err) {
                console.error(err)
                busy(requestSubmit, false, "ส่งคำขอเข้าใช้งาน")
                showError("ส่งคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง")
            }
        })

        requestBack.addEventListener("click", () => {
            clearMsg()
            requestStep.classList.add("hidden")
            emailStep.classList.remove("hidden")
            reqName.value = ""
            emailInput.focus()
        })
      })()
