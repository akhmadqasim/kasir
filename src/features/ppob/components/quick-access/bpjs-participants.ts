export const BPJS_TYPE_OPTIONS = [
  { value: "BPJSKES", label: "Kesehatan", serviceLabel: "BPJS Kesehatan" },
  { value: "BPJSTK", label: "Ketenagakerjaan", serviceLabel: "BPJS Ketenagakerjaan" },
] as const

export type BpjsType = (typeof BPJS_TYPE_OPTIONS)[number]["value"]

export interface BpjsParticipant {
  number: string
  name: string
}

export function getBpjsDataBook(rawData: Record<string, unknown> | undefined): string {
  const inquiry = rawData?.inquiry
  if (
    inquiry &&
    typeof inquiry === "object" &&
    typeof (inquiry as { data_book?: unknown }).data_book === "string"
  ) {
    return (inquiry as { data_book: string }).data_book
  }

  const data = rawData?.data
  if (
    data &&
    typeof data === "object" &&
    typeof (data as { data_book?: unknown }).data_book === "string"
  ) {
    return (data as { data_book: string }).data_book
  }

  return ""
}

export function parseBpjsParticipants(dataBook: string): BpjsParticipant[] {
  const participants: BpjsParticipant[] = []
  let current: Partial<BpjsParticipant> = {}

  const pushCurrent = () => {
    if (current.number || current.name) {
      participants.push({
        number: current.number ?? "",
        name: current.name ?? "",
      })
      current = {}
    }
  }

  for (const line of dataBook.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith("----- Peserta")) {
      pushCurrent()
      continue
    }

    const [label, rawValue] = trimmed.split(/\s*:\s*/, 2)
    const value = rawValue?.trim() ?? ""
    if (!value) continue

    if (label === "Nomor Peserta") {
      current.number = value
    } else if (label === "Nama Peserta") {
      current.name = value
    }
  }

  pushCurrent()
  return participants
}
