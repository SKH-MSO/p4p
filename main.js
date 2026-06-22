const express = require("express")
const process = require("node:process")
const line = require("@line/bot-sdk")
const axios = require("axios")
const app = express()

const port = process.env.PORT || 3000
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN
const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID

const headers = {
  "Content-Type": "application/json",
  "Authorization": "Bearer " + LINE_ACCESS_TOKEN
}
const config = {
  channelSecret: LINE_CHANNEL_SECRET,
}
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: LINE_ACCESS_TOKEN,
})
const color_array = [
  ["bg-red-300", "#ffa2a2"],
  ["bg-orange-300", "#ffb86a"],
  ["bg-yellow-300", "#ffdf20"],
  ["bg-lime-300", "#bbf451"],
  ["bg-green-300", "#7bf1a8"],
  ["bg-teal-300", "#46ecd5"],
  ["bg-cyan-300", "#53eafd"],
  ["bg-sky-300", "#74d4ff"],
  ["bg-blue-300", "#8ec5ff"],
  ["bg-indigo-300", "#a3b3ff"],
  ["bg-violet-300", "#c4b4ff"],
  ["bg-fuchsia-300", "#f4a8ff"],
]
const month_array = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
]
const month_iterator = [
  [[0, 0], [11, -1], [10, -1], [9, -1], [8, -1], [7, -1]],
  [[1, 0], [0, 0], [11, -1], [10, -1], [9, -1], [8, -1]],
  [[2, 0], [1, 0], [0, 0], [11, -1], [10, -1], [9, -1]],
  [[3, 0], [2, 0], [1, 0], [0, 0], [11, -1], [10, -1]],
  [[4, 0], [3, 0], [2, 0], [1, 0], [0, 0], [11, -1]],
  [[5, 0], [4, 0], [3, 0], [2, 0], [1, 0], [0, 0]],
  [[6, 0], [5, 0], [4, 0], [3, 0], [2, 0], [1, 0]],
  [[7, 0], [6, 0], [5, 0], [4, 0], [3, 0], [2, 0]],
  [[8, 0], [7, 0], [6, 0], [5, 0], [4, 0], [3, 0]],
  [[9, 0], [8, 0], [7, 0], [6, 0], [5, 0], [4, 0]],
  [[10, 0], [9, 0], [8, 0], [7, 0], [6, 0], [5, 0]],
  [[11, 0], [10, 0], [9, 0], [8, 0], [7, 0], [6, 0]]
]

app.use("/status", express.static("status"))
app.use("/list", express.static("list"))
app.use("/ranking", express.static("ranking"))
app.use("/assets", express.static("assets"))

// ── GET /api/drive-files?sheetname=YYYY_MM ───────────────────────────────────
// Returns { files: ["สมชาย ใจดี", ...] }  (file names without extension)
app.get("/api/drive-files", async (req, res) => {
  const sheetname = req.query.sheetname
  if (!sheetname || !/^\d{4}_\d{2}$/.test(sheetname)) {
    return res.status(400).json({ error: "sheetname must be in YYYY_MM format" })
  }

  const year = sheetname.slice(0, 4)                        // e.g. "2568"
  const monthNum = parseInt(sheetname.slice(5))                 // e.g. 3
  const monthName = month_array[monthNum - 1]                    // e.g. "มีนาคม"

  try {
    // 1. Refresh access token
    const tokenResp = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    )
    const token = tokenResp.data.access_token
    const auth = { Authorization: `Bearer ${token}` }

    // helper: list Drive items with a query
    const driveList = (q) =>
      axios.get("https://www.googleapis.com/drive/v3/files", {
        params: { q, fields: "files(id,name)", pageSize: 1000 },
        headers: auth,
      })

    // 2. Find year folder inside root  (e.g. name = "2568")
    const yearResp = await driveList(
      `'${DRIVE_ROOT_FOLDER_ID}' in parents and name='${year}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )
    const yearFolder = yearResp.data.files[0]
    if (!yearFolder) return res.json({ files: [] })

    // 3. Find month folder inside year  (e.g. name = "3 - มีนาคม")
    const monthFolderName = `${monthNum} - ${monthName}`
    const monthResp = await driveList(
      `'${yearFolder.id}' in parents and name='${monthFolderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )
    const monthFolder = monthResp.data.files[0]
    if (!monthFolder) return res.json({ files: [] })

    // 4. List ALL files in month folder with pagination, strip extension
    let allFiles = []
    let pageToken = undefined
    do {
      const params = {
        q: `'${monthFolder.id}' in parents and trashed=false`,
        fields: "nextPageToken,files(id,name)",
        pageSize: 1000,
      }
      if (pageToken) params.pageToken = pageToken
      const resp = await axios.get("https://www.googleapis.com/drive/v3/files", { params, headers: auth })
      allFiles = allFiles.concat(resp.data.files || [])
      pageToken = resp.data.nextPageToken
    } while (pageToken)
    const files = allFiles.map((f) => f.name.replace(/\.[^/.]+$/, ""))
    return res.json({ files })

  } catch (err) {
    console.error("Drive API error:", err.response?.data || err.message)
    return res.status(500).json({ error: "Drive API error" })
  }
})
// ─────────────────────────────────────────────────────────────────────────────

app.post("/line", line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err)
      res.status(500).end()
    })
})

const handleEvent = async (event) => {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null)
  }
  try {
    await axios.post("https://api.line.me/v2/bot/chat/loading/start",
      { "chatId": event.source.userId },
      { headers: headers }
    )
  } catch (error) {
    console.error(error)
  }
  const message = event.message.text.trim().toLowerCase()
  if (message === "status") {
    return client.replyMessage({
      "replyToken": event.replyToken,
      "messages": [createStatusList()]
    })
  }
  return Promise.resolve(null)
}

const createStatusList = () => {
  const object = {
    "type": "flex",
    "altText": "เลือกเดือนที่ต้องการ",
    "contents": {
      "type": "bubble",
      "size": "mega",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": "กรุณาเลือกเดือน",
                "align": "center",
                "color": "#FFFFFF",
                "size": "xxl",
                "margin": "md",
                "offsetBottom": "sm",
                "weight": "bold",
              },
              {
                "type": "text",
                "text": "สามารถดูได้ 6 เดือนย้อนหลัง",
                "color": "#ffffa0",
                "align": "center",
              },
            ],
          },
        ],
        "backgroundColor": "#4B3D33",
        "paddingAll": "xxl",
      },
      "hero": {
        "type": "box",
        "layout": "vertical",
        "contents": [],
        "height": "5px",
        "backgroundColor": "#81A7AE",
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          createStatusSublist(0),
          createStatusSublist(1),
          createStatusSublist(2),
          createStatusSublist(3),
          createStatusSublist(4),
          createStatusSublist(5),
        ],
        "backgroundColor": "#F5F5F0",
      }
    }
  }
  return object
}

const createStatusSublist = (i) => {
  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear() + 543
  const iterator = month_iterator[month]
  const name = month_array[iterator[i][0]] + " " + (year + iterator[i][1])
  const color_hex = color_array[iterator[i][0]][1]
  const color_tw = color_array[iterator[i][0]][0]
  const sheetname = (year + iterator[i][1]) + "_" + String(iterator[i][0] + 1).padStart(2, '0')
  const object = {
    "type": "box",
    "layout": "horizontal",
    "contents": [
      {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": name,
            "align": "center",
            "size": "lg",
            "style": "italic",
            "weight": "bold",
          },
        ],
        "backgroundColor": color_hex,
        "cornerRadius": "sm",
        "borderColor": color_hex,
        "borderWidth": "semi-bold",
        "flex": 3,
        "paddingAll": "md",
      },
      {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "คลิก",
            "align": "center",
            "weight": "bold",
            "size": "lg",
            "color": "#412D11",
          },
        ],
        "backgroundColor": "#f5f5f5",
        "cornerRadius": "md",
        "offsetEnd": "md",
        "borderColor": "#412D11",
        "borderWidth": "semi-bold",
        "flex": 1,
        "paddingAll": "md",
        "action": {
          "type": "uri",
          "label": sheetname,
          "uri": "https://liff.line.me/2008561527-a0xP1XmY?sheetname=" +
            sheetname +
            "&color=" + color_tw,
        },
      },
    ],
    "paddingBottom": "xxl",
    "paddingTop": "xxl",
  }
  return object
}

// On Vercel the exported app is used as the serverless handler.
// app.listen only runs for local dev (node main.js).
if (require.main === module) {
  app.listen(port, () => { console.log("P4P server is live") })
}

module.exports = app

