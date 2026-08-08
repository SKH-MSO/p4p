import { describe, expect, it } from "vitest"
import { DEPARTMENTS, departmentLabel, fullName, sortDepartments } from "../departments"

describe("sortDepartments", () => {
  it("restores the canonical order from a shuffled list", () => {
    const shuffled = [...DEPARTMENTS].reverse()
    expect(sortDepartments(shuffled)).toEqual([...DEPARTMENTS])
  })

  it("puts unknown departments after every known one", () => {
    const sorted = sortDepartments(["ไม่ทราบ", "อายุรกรรม", "กุมารเวชกรรม"])
    expect(sorted).toEqual(["กุมารเวชกรรม", "อายุรกรรม", "ไม่ทราบ"])
  })

  it("sorts unknown departments among themselves alphabetically", () => {
    const sorted = sortDepartments(["ฮ department", "ก department"])
    expect(sorted).toEqual(["ก department", "ฮ department"])
  })

  it("does not mutate its input", () => {
    const input = ["อายุรกรรม", "กุมารเวชกรรม"]
    sortDepartments(input)
    expect(input).toEqual(["อายุรกรรม", "กุมารเวชกรรม"])
  })

  it("keeps INTERN last, where the canonical list puts it", () => {
    expect(sortDepartments(["INTERN", "ศัลยกรรม"]).at(-1)).toBe("INTERN")
  })
})

describe("departmentLabel", () => {
  it("prefixes Thai departments", () => {
    expect(departmentLabel("อายุรกรรม")).toBe("กลุ่มงานอายุรกรรม")
  })

  it("leaves INTERN alone", () => {
    expect(departmentLabel("INTERN")).toBe("INTERN")
  })
})

describe("fullName", () => {
  it("joins both parts", () => {
    expect(fullName("สมชาย", "ใจดี")).toBe("สมชาย ใจดี")
  })

  it("never renders a missing part as 'null'", () => {
    // The bug this guards: a plain template join produced "สมชาย null".
    expect(fullName("สมชาย", null)).toBe("สมชาย")
    expect(fullName(null, "ใจดี")).toBe("ใจดี")
    expect(fullName(undefined, undefined)).toBe("")
  })
})
