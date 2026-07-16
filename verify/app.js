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

        // ── LINE userId binding — REQUIRED, not best-effort ─────────────────────
        // Business rule: we must know every physician's LINE userId as of their
        // first verification. liff.init() itself can still fail silently (no
        // LINE-side consequence if it does — see attemptLineBind/runLineBindFlow
        // below for how a failure is actually handled: retried, then — after
        // BIND_ATTEMPT_LIMIT tries recorded server-side — let through anyway with
        // an admin alert, so a genuine device/permission problem can't lock a
        // physician out of a monthly-use tool forever).
        //
        // Dedicated LIFF app for THIS page. liff.init() requires the current
        // page to match the LIFF app's registered Endpoint URL — it is NOT
        // enough for the id to belong to the same LINE channel. /verify/ is
        // reached via an internal 302 redirect from /status, /ranking, or
        // /list (each of which has ITS OWN LIFF app + endpoint — see
        // scripts/setup-richmenu.mjs / scripts/update-month-picker.mjs), so
        // initializing with any of THOSE ids here failed with "Invalid LIFF
        // ID" / INIT_FAILED regardless of entry point. This id's Endpoint
        // URL is set to /verify/ specifically, matching where this actually runs.
        const LIFF_ID = "2008561527-AShTrJz0"
        let liffInitError = null
        const liffReady = liff.init({ liffId: LIFF_ID }).then(() => true).catch((err) => {
            console.warn("liff.init failed:", err)
            liffInitError = err
            return false
        })

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
        const otpBoxes    = Array.from(document.querySelectorAll(".otp-box"))
        const emailSubmit = document.getElementById("email-submit")
        const codeSubmit  = document.getElementById("code-submit")
        const backBtn     = document.getElementById("back-btn")
        const sentTo      = document.getElementById("sent-to")
        const requestStep = document.getElementById("request-step")
        const reqName     = document.getElementById("reqname")
        const reqEmail    = document.getElementById("req-email")
        const requestSubmit = document.getElementById("request-submit")
        const requestBack = document.getElementById("request-back")
        const bindStep       = document.getElementById("bind-step")
        const bindStatusText = document.getElementById("bind-status-text")
        const bindRetryBtn   = document.getElementById("bind-retry-btn")
        const bindDebugLog   = document.getElementById("bind-debug-log")
        const msg         = document.getElementById("msg")
        const emailLoadingDots = document.getElementById("email-loading-dots")

        let currentEmail = ""

        // ── Helpers ───────────────────────────────────────────────────────────
        // Declared here (before the bind-only early-return below) rather than
        // further down: the bind flow's async callbacks reference these, and if
        // bind-only mode returns early, a `const` declared after that return
        // point is never reached — a later reference to it from an already-
        // in-flight async callback throws (temporal dead zone), which was
        // silently swallowed into the bind flow's own .catch() as a false
        // "bind failed" the first time this shipped. Keep these above ANY early
        // return in this file.
        const showError  = (text) => { msg.className = "msg error";  msg.textContent = text }
        const showOk     = (text) => { msg.className = "msg ok";     msg.textContent = text }
        const showNotice = (text) => { msg.className = "msg notice"; msg.textContent = text }
        const clearMsg   = ()     => { msg.className = "msg";        msg.textContent = "" }
        const busy = (btn, on, label) => {
            btn.disabled = on
            btn.innerHTML = on ? '<span class="spinner"></span>' + label : label
        }

        // ── Shared LINE-bind flow — used by BOTH entry points ───────────────────
        //   1. Fresh OTP verify (codeStep handler): token = data.session.access_token
        //   2. Silent bind bounce (server injected <meta name="p4p-session">):
        //      token = the injected token, no OTP involved at all
        // A retry here must NEVER re-run verifyOtp() — OTP codes are single-use,
        // so retrying the whole form would fail on the already-consumed code.
        // Instead the retry button just re-attempts the bind itself with the
        // SAME still-valid access token.
        function buildAuthedClient(accessToken) {
            return supabase.createClient(P4P.SUPABASE_URL, P4P.SUPABASE_KEY, {
                // Don't reuse `db` / rely on supabase-js's own session bookkeeping —
                // this project already found that unreliable inside LINE's in-app
                // webview (same reason /auth/session extracts tokens directly
                // instead of trusting client-side persistence). Attaching the
                // token explicitly as a header works regardless of that quirk.
                auth: { persistSession: false, autoRefreshToken: false },
                global: { headers: { Authorization: `Bearer ${accessToken}` } },
            })
        }

        // Describes ANY error (JS Error, Supabase PostgrestError, string, etc.)
        // into one readable line — used for the on-screen debug log below, since
        // the physician's device is otherwise a black box with no console access.
        function describeError(err) {
            if (!err) return "unknown error"
            const parts = []
            if (err.message) parts.push(err.message)
            if (err.details) parts.push("details: " + err.details)
            if (err.hint) parts.push("hint: " + err.hint)
            if (err.code) parts.push("code: " + err.code)
            // Dump every OTHER own-enumerable property too — the fixed
            // message/details/hint/code list above covers Supabase/PostgREST
            // errors, but a LIFF SDK error may carry additional fields (e.g.
            // a more specific sub-reason) that this was silently dropping,
            // which is exactly the information needed to pin down why
            // liff.init() rejects a same-page-endpoint LIFF id.
            const known = new Set(["message", "details", "hint", "code"])
            for (const key of Object.keys(err)) {
                if (known.has(key)) continue
                try {
                    const val = typeof err[key] === "object" ? JSON.stringify(err[key]) : String(err[key])
                    parts.push(`${key}: ${val}`)
                } catch { /* unstringifiable — skip */ }
            }
            return parts.length ? parts.join(" | ") : String(err)
        }

        async function attemptLineBind(accessToken) {
            const inited = await liffReady
            if (!inited) {
                // Surface exactly what was attempted, not just the error —
                // the previous "Invalid LIFF ID" report gave no way to
                // confirm the id/URL actually in play at failure time.
                throw new Error(
                    "liff.init failed: " + describeError(liffInitError) +
                    ` | liffId used: ${LIFF_ID}` +
                    ` | page URL: ${location.href}`
                )
            }
            if (!liff.isLoggedIn()) throw new Error("liff.isLoggedIn() returned false")

            let profile
            try {
                profile = await liff.getProfile()
            } catch (err) {
                throw new Error("liff.getProfile failed: " + describeError(err))
            }

            const { error } = await buildAuthedClient(accessToken).rpc("bind_line_user_id", {
                p_line_user_id: profile.userId,
                p_line_display_name: profile.displayName || null,
            })
            if (error) throw new Error("bind_line_user_id RPC failed: " + describeError(error))
        }

        // Records one failed attempt server-side and returns the running count.
        // If the RPC call itself can't even be reached, fail OPEN (treat as if
        // the limit were hit) — a physician must never be trapped by a failure
        // in the failure-recording mechanism itself.
        async function recordBindFailure(accessToken) {
            try {
                const { data, error } = await buildAuthedClient(accessToken).rpc("record_bind_failure")
                if (error) throw error
                return typeof data === "number" ? data : BIND_ATTEMPT_LIMIT
            } catch (err) {
                console.warn("record_bind_failure failed:", err)
                return BIND_ATTEMPT_LIMIT
            }
        }

        const BIND_ATTEMPT_LIMIT = 3
        let currentBindToken = null

        // Drives the bind-step UI end to end: attempt -> success (redirect) or
        // failure -> record it -> under the limit (show retry) or at the limit
        // (let them through anyway; scripts/line-bind-gate.sql already fired a
        // one-time Telegram alert to the admin at that point).
        function runLineBindFlow(accessToken) {
            currentBindToken = accessToken
            emailStep.classList.add("hidden")
            codeStep.classList.add("hidden")
            requestStep.classList.add("hidden")
            bindStep.classList.remove("hidden")
            bindRetryBtn.classList.add("hidden")
            bindStatusText.innerHTML = '<span class="spinner spinner-dark"></span>กำลังยืนยันบัญชี LINE ของท่าน โปรดรอสักครู่...'

            attemptLineBind(accessToken).then(() => {
                showOk("ยืนยันสำเร็จ กำลังนำท่านเข้าสู่ระบบ...")
                location.replace(RETURN_TO)
            }).catch(async (err) => {
                console.warn("LINE bind failed:", err)
                const ts = new Date().toISOString().slice(11, 19)
                bindDebugLog.textContent += `[${ts}] ${describeError(err)}\n`
                bindDebugLog.classList.remove("hidden")

                const attempts = await recordBindFailure(accessToken)
                if (attempts >= BIND_ATTEMPT_LIMIT) {
                    bindStatusText.textContent = "ข้ามขั้นตอนนี้ชั่วคราว กำลังนำท่านเข้าสู่ระบบ..."
                    setTimeout(() => location.replace(RETURN_TO), 1200)
                } else {
                    bindStatusText.textContent = "ไม่สามารถยืนยันบัญชี LINE ได้ กรุณาลองใหม่อีกครั้ง"
                    bindRetryBtn.classList.remove("hidden")
                }
            })
        }
        bindRetryBtn.addEventListener("click", () => runLineBindFlow(currentBindToken))

        // ── Silent-bind bounce ───────────────────────────────────────────────────
        // main.js redirects an already-verified-but-unbound session here with a
        // real access token injected into <meta name="p4p-session"> (see
        // servePage's "bind_required" case) instead of the usual placeholder.
        // When that's the case, skip straight to the bind flow — no email/OTP
        // entry needed, this person is already logged in.
        const sessionMeta = document.querySelector('meta[name="p4p-session"]')
        const injectedToken = sessionMeta ? sessionMeta.getAttribute("content") : ""
        if (injectedToken && injectedToken !== "__P4P_ACCESS_TOKEN__") {
            runLineBindFlow(injectedToken)
            return
        }

        // ── Email input intro loading state ──────────────────────────────────
        // Briefly show loading dots over the email input (disabled underneath)
        // when the page first lands on step 1, then hand control to the user.
        emailInput.disabled = true
        setTimeout(() => {
            emailInput.disabled = false
            emailLoadingDots.classList.add("hidden")
        }, 6000)

        // ── Physician-name dropdown (request-access step) ───────────────────────
        // Populated from every roster table combined (list_all_physicians RPC —
        // see scripts/list-all-physicians.sql) instead of free-text, so a new
        // physician picks their own name rather than typing it. Sorted with
        // proper Thai dictionary order: a plain byte-order sort gets leading
        // vowels (เ/แ/โ/ใ/ไ) wrong since they're written before the consonant
        // they belong to but sort after it in a real Thai dictionary.
        async function loadPhysicianNames() {
            try {
                const { data, error } = await db.rpc("list_all_physicians")
                if (error) throw error
                const names = (data || []).map((r) => r.full_name).filter(Boolean)
                names.sort((a, b) => a.localeCompare(b, "th"))
                reqName.firstElementChild.textContent = "-- เลือกชื่อของท่าน --"
                for (const name of names) {
                    const opt = document.createElement("option")
                    opt.value = name
                    opt.textContent = name
                    reqName.appendChild(opt)
                }
                reqName.disabled = false
            } catch (err) {
                console.error("loadPhysicianNames failed:", err)
                // Leave it disabled — the request-step submit handler requires a
                // real selection, so this fails safe rather than silently letting
                // the placeholder value through.
            }
        }
        loadPhysicianNames()

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

        // ── OTP six-box input ─────────────────────────────────────────────────
        const getOtpValue = () => otpBoxes.map((b) => b.value).join("")
        const clearOtpBoxes = () => { otpBoxes.forEach((b) => (b.value = "")) }

        otpBoxes.forEach((box, i) => {
            // Normal typing: keep only the last digit typed, advance to the next box.
            // Bulk fill (autofill suggestion, or a paste that slipped past the
            // dedicated paste handler below): distribute the digits across this
            // box and the following ones. No native maxlength is set on these
            // inputs specifically so a multi-character autofill/paste isn't
            // silently truncated to 1 char before this handler ever sees it.
            box.addEventListener("input", () => {
                const digits = box.value.replace(/\D/g, "")
                if (digits.length > 1) {
                    for (let k = 0; k < digits.length && i + k < otpBoxes.length; k++) {
                        otpBoxes[i + k].value = digits[k]
                    }
                    otpBoxes[Math.min(i + digits.length, otpBoxes.length - 1)].focus()
                } else {
                    box.value = digits
                    if (digits && i < otpBoxes.length - 1) otpBoxes[i + 1].focus()
                }
            })

            box.addEventListener("keydown", (e) => {
                if (e.key === "Backspace" && !box.value && i > 0) {
                    e.preventDefault()
                    otpBoxes[i - 1].value = ""
                    otpBoxes[i - 1].focus()
                } else if (e.key === "ArrowLeft" && i > 0) {
                    e.preventDefault()
                    otpBoxes[i - 1].focus()
                } else if (e.key === "ArrowRight" && i < otpBoxes.length - 1) {
                    e.preventDefault()
                    otpBoxes[i + 1].focus()
                }
            })

            // Explicit paste handling: intercept BEFORE the browser inserts the
            // clipboard text, so a full 6-digit paste anywhere always distributes
            // correctly regardless of how the target browser would otherwise
            // truncate/insert it.
            box.addEventListener("paste", (e) => {
                e.preventDefault()
                const text = (e.clipboardData || window.clipboardData).getData("text")
                const digits = text.replace(/\D/g, "").slice(0, otpBoxes.length - i)
                for (let k = 0; k < digits.length; k++) otpBoxes[i + k].value = digits[k]
                if (digits.length) otpBoxes[Math.min(i + digits.length, otpBoxes.length - 1)].focus()
            })
        })

        // Switch to the code-entry step for a given email (after sending, or on
        // restore after a reload).
        const goToCodeStep = (email) => {
            currentEmail = email
            sentTo.textContent = email
            emailStep.classList.add("hidden")
            codeStep.classList.remove("hidden")
            otpBoxes[0].focus()
        }

        // Why did the server send us here? "expired" = the session lapsed;
        // "blocked" = revoked via blocked_emails (a valid session is not enough —
        // main.js re-checks the denylist on every gated-page request); "no_session"
        // is the everyday logged-out case and stays silent.
        const bounceReason = new URLSearchParams(location.search).get("reason")
        const reasonShown = bounceReason === "expired" || bounceReason === "blocked"
        if (bounceReason === "expired") {
            showNotice("เซสชันหมดอายุ กรุณายืนยันตัวตนอีกครั้ง")
        } else if (bounceReason === "blocked") {
            showError("บัญชีของท่านถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ")
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
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
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

        // ── Step 2 — verify the OTP ───────────────────────────────────────────
        codeStep.addEventListener("submit", async (e) => {
            e.preventDefault()
            clearMsg()
            const token = getOtpValue()
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

                // Session is live at this point. Binding the LINE userId is now a
                // REQUIRED step, not best-effort — runLineBindFlow takes over the UI
                // from here (retry-on-failure, then give up after BIND_ATTEMPT_LIMIT
                // and let them through) and handles the final redirect itself.
                runLineBindFlow(data.session.access_token)
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
            clearOtpBoxes()
            emailInput.focus()
        })

        // ── Step 2b — submit an access request (name + email) ─────────────────
        requestStep.addEventListener("submit", async (e) => {
            e.preventDefault()
            clearMsg()
            const name = reqName.value.trim()
            if (name.length < 2) {
                showError("กรุณาเลือกชื่อของท่านจากรายการ")
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
