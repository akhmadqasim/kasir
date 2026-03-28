import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { id } from "@/i18n/id"

export function BpjsFlow() {
  const navigate = useNavigate()
  const [bpjsNumber, setBpjsNumber] = useState("")
  const [period, setPeriod] = useState("")

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ppob")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{id.ppob.bpjs}</h1>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          {/* BPJS Form */}
          <Card>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-base">{id.ppob.bpjsNumber}</Label>
                <Input
                  type="text"
                  placeholder={id.ppob.bpjsNumberPlaceholder}
                  value={bpjsNumber}
                  onChange={(e) => setBpjsNumber(e.target.value.replace(/\D/g, ""))}
                  className="max-w-sm font-mono text-xl md:text-xl h-12"
                />
              </div>

              <div className="space-y-2">
                <Label>{id.ppob.period}</Label>
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="max-w-sm">
                    <SelectValue placeholder={id.ppob.period} />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                      <SelectItem key={month} value={String(month)}>
                        {month} {id.ppob.periodMonths}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="col-span-4">
          <div className="sticky top-6">
            {bpjsNumber.length >= 10 && period ? (
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{id.ppob.confirm}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.bpjsNumber}</span>
                    <span className="font-mono text-base font-medium">{bpjsNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{id.ppob.period}</span>
                    <span className="font-medium">
                      {period} {id.ppob.periodMonths}
                    </span>
                  </div>
                  <Button className="w-full mt-4" size="lg" disabled>
                    {id.ppob.process} (Coming Soon)
                  </Button>
                </CardContent>
              </Card>
            ) : bpjsNumber.length >= 10 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Pilih produk untuk melihat konfirmasi
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
