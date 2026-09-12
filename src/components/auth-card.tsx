import type { ReactNode } from "react"
import { Avatar, Card } from "@heroui/react"
import { Store } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Kartu untuk layar yang berdiri sendiri sebelum pengguna masuk: login dan dua
 * langkah onboarding.
 *
 * Bentuknya menyalin `login-demo.tsx` resmi HeroUI, bukan dikarang: `Card`
 * dengan `p-5` dan kepala bertumpuk di tengah — `Avatar` berisi ikon lalu
 * `Card.Title`. `p-5` adalah satu-satunya tempat padding `Card` ditimpa di
 * aplikasi ini, dan alasannya demo HeroUI sendiri melakukannya untuk kartu yang
 * berdiri sendiri di tengah layar kosong.
 */
export function AuthCard({
  title,
  size = "sm",
  children,
}: {
  title: string
  /**
   * `md` untuk kartu yang menyandingkan dua kolom isian dalam satu baris —
   * langkah onboarding melakukannya supaya keempat kolomnya muat tanpa
   * menggulung di jendela pendek. Login tetap `sm`, satu kolom.
   */
  size?: "sm" | "md"
  children: ReactNode
}) {
  return (
    <Card className={cn("w-full p-5", size === "md" ? "max-w-md" : "max-w-sm")}>
      <Card.Header className="items-center gap-2">
        <Avatar>
          <Avatar.Fallback>
            <Store className="size-4" />
          </Avatar.Fallback>
        </Avatar>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content className="gap-4">{children}</Card.Content>
    </Card>
  )
}

/**
 * Latar layar auth: kanvas kosong, kartunya di tengah.
 *
 * Tingginya dipatok `h-svh` dan bukan `min-h-svh`: `body` memakai
 * `overflow-hidden`, jadi wadah yang boleh tumbuh melebihi layar tidak akan
 * pernah menggulung — ia hanya terpotong. Dengan tinggi tetap, `overflow-y-auto`
 * di sini benar-benar bekerja saat kartunya memang lebih tinggi dari layar, dan
 * `items-center-safe` menjaga tepi atas kartu tetap terjangkau (perataan tengah
 * biasa memotongnya di sisi yang tidak bisa digulung). `items-center` ditulis
 * bersamanya sebagai cadangan: kata kunci `safe` baru ada di Chromium 129+, dan
 * di WebView2 yang lebih tua deklarasinya dibuang — tanpa cadangan itu
 * `align-items` jatuh ke `normal` dan kartunya merentang setinggi layar.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-svh items-center items-center-safe justify-center overflow-y-auto bg-background px-6 py-4">
      {children}
    </div>
  )
}
