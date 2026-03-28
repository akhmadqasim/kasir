import { AlertCircle, RefreshCw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { id } from "@/i18n/id"

interface PpobErrorProps {
  message?: string
  onRetry?: () => void
}

export function PpobError({ message, onRetry }: PpobErrorProps) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="flex flex-col items-center justify-center py-8 text-center">
        <AlertCircle className="h-10 w-10 text-destructive mb-3" />
        <p className="text-sm text-destructive font-medium mb-1">
          {id.ppob.failed}
        </p>
        <p className="text-xs text-muted-foreground mb-4 max-w-md">
          {message || id.ppob.connectionError}
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-3 w-3" />
            {id.ppob.retry}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
