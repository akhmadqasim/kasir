import { useState, useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PlusIcon, PencilIcon, UserXIcon, UserCheckIcon, SearchIcon } from "lucide-react"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useUsers, useToggleUserActive } from "../hooks/use-users"
import { UserFormDialog } from "./user-form-dialog"
import type { User } from "@/features/auth/types"

export function UsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const { data: users, isLoading } = useUsers(currentUser!.id)
  const toggleActive = useToggleUserActive()

  const [search, setSearch] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [deactivateUser, setDeactivateUser] = useState<User | null>(null)

  const filteredUsers = useMemo(() => {
    if (!users) return []
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.full_name.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    )
  }, [users, search])

  const handleEdit = (user: User) => {
    setEditingUser(user)
    setFormOpen(true)
  }

  const handleAdd = () => {
    setEditingUser(null)
    setFormOpen(true)
  }

  const handleToggleActive = (user: User) => {
    if (!user.is_active) {
      // Reactivate directly
      toggleActive.mutate({
        userId: user.id,
        isActive: true,
        currentUserId: currentUser?.id ?? 0,
      })
    } else {
      // Confirm deactivation
      setDeactivateUser(user)
    }
  }

  const confirmDeactivate = () => {
    if (!deactivateUser || !currentUser) return
    toggleActive.mutate(
      {
        userId: deactivateUser.id,
        isActive: false,
        currentUserId: currentUser.id,
      },
      { onSettled: () => setDeactivateUser(null) }
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{id.users.title}</h1>
        <Button onClick={handleAdd}>
          <PlusIcon className="mr-2 h-4 w-4" />
          {id.users.addUser}
        </Button>
      </div>

      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={id.users.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">No</TableHead>
              <TableHead>{id.users.username}</TableHead>
              <TableHead>{id.users.fullName}</TableHead>
              <TableHead>{id.users.role}</TableHead>
              <TableHead>{id.users.status}</TableHead>
              <TableHead className="text-right">{id.users.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Memuat...
                </TableCell>
              </TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {search ? "Tidak ada hasil" : id.users.noUsers}
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user, index) => (
                <TableRow key={user.id} className={!user.is_active ? "opacity-50" : ""}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell>{user.full_name}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                      {user.role === "admin" ? id.users.admin : id.users.kasir}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "default" : "outline"}>
                      {user.is_active ? id.users.active : id.users.inactive}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(user)}
                        title={id.users.edit}
                      >
                        <PencilIcon className="h-4 w-4" />
                      </Button>
                      {user.id !== currentUser?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggleActive(user)}
                          title={user.is_active ? id.users.deactivate : id.users.activate}
                        >
                          {user.is_active ? (
                            <UserXIcon className="h-4 w-4 text-destructive" />
                          ) : (
                            <UserCheckIcon className="h-4 w-4 text-green-600" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        user={editingUser}
      />

      <AlertDialog open={!!deactivateUser} onOpenChange={(v) => !v && setDeactivateUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{id.users.deactivate}</AlertDialogTitle>
            <AlertDialogDescription>
              {id.users.deactivateConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{id.users.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate}>
              {id.users.deactivate}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
