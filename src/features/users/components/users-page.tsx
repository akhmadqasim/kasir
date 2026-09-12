import { useState, useMemo } from "react"
import { PlusIcon, PencilIcon, UserXIcon, UserCheckIcon } from "lucide-react"
import { AlertDialog, Button, SearchField, Skeleton, Table } from "@heroui/react"

import { NavbarActions } from "@/components/layout/app-navbar"
import { NoData } from "@/components/no-data"
import { StatusBadge } from "@/components/status-badge"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import { useUsers, useToggleUserActive } from "../hooks/use-users"
import { UserFormDialog } from "./user-form-dialog"
import type { User } from "@/features/auth/types"

const COLUMN_COUNT = 6

export function UsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const { data: users, isLoading, isError, error } = useUsers()
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
        u.role.toLowerCase().includes(q),
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
      },
      { onSettled: () => setDeactivateUser(null) },
    )
  }

  const renderEmptyState = () =>
    isError ? (
      <NoData
        title={`Gagal memuat daftar pengguna: ${error?.message ?? id.common.error}`}
        tone="danger"
      />
    ) : (
      <NoData title={search ? "Tidak ada hasil" : id.users.noUsers} />
    )

  return (
    // DESIGN.md §5.1: judul dari navbar, aksi lewat `NavbarActions`.
    <div className="flex flex-col gap-4">
      <NavbarActions>
        <Button isDisabled={isError} size="sm" onPress={handleAdd}>
          <PlusIcon />
          {id.users.addUser}
        </Button>
      </NavbarActions>

      <SearchField
        aria-label={id.users.searchPlaceholder}
        fullWidth
        value={search}
        onChange={setSearch}
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder={id.users.searchPlaceholder} />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      <Table variant="secondary">
        <Table.ScrollContainer>
          <Table.Content aria-label={id.users.title}>
            <Table.Header>
              <Table.Column className="w-12">No</Table.Column>
              <Table.Column isRowHeader>{id.users.username}</Table.Column>
              <Table.Column>{id.users.fullName}</Table.Column>
              <Table.Column>{id.users.role}</Table.Column>
              <Table.Column>{id.users.status}</Table.Column>
              <Table.Column className="text-right">{id.users.actions}</Table.Column>
            </Table.Header>
            <Table.Body renderEmptyState={renderEmptyState}>
              {isLoading
                ? Array.from({ length: 3 }).map((_, rowIndex) => (
                    <Table.Row key={`skeleton-${rowIndex}`} id={`skeleton-${rowIndex}`}>
                      {Array.from({ length: COLUMN_COUNT }).map((_, cellIndex) => (
                        <Table.Cell key={cellIndex}>
                          <Skeleton className="h-5 w-full" />
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  ))
                : filteredUsers.map((user, index) => (
                    <Table.Row
                      key={user.id}
                      id={user.id}
                      className={user.is_active ? undefined : "opacity-50"}
                      textValue={user.username}
                    >
                      <Table.Cell>{index + 1}</Table.Cell>
                      <Table.Cell className="font-medium">{user.username}</Table.Cell>
                      <Table.Cell>{user.full_name}</Table.Cell>
                      <Table.Cell>
                        <StatusBadge status={user.role === "admin" ? "info" : "neutral"}>
                          {user.role === "admin" ? id.users.admin : id.users.kasir}
                        </StatusBadge>
                      </Table.Cell>
                      <Table.Cell>
                        <StatusBadge status={user.is_active ? "success" : "neutral"}>
                          {user.is_active ? id.users.active : id.users.inactive}
                        </StatusBadge>
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            aria-label={`${id.users.edit} ${user.username}`}
                            isIconOnly
                            size="sm"
                            variant="secondary"
                            onPress={() => handleEdit(user)}
                          >
                            <PencilIcon />
                          </Button>
                          {user.id !== currentUser?.id && (
                            <Button
                              aria-label={`${user.is_active ? id.users.deactivate : id.users.activate} ${user.username}`}
                              isIconOnly
                              size="sm"
                              variant={user.is_active ? "danger" : "secondary"}
                              onPress={() => handleToggleActive(user)}
                            >
                              {user.is_active ? <UserXIcon /> : <UserCheckIcon />}
                            </Button>
                          )}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <UserFormDialog open={formOpen} onOpenChange={setFormOpen} user={editingUser} />

      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={false}
        isOpen={!!deactivateUser}
        onOpenChange={(open) => !open && setDeactivateUser(null)}
      >
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog aria-label={id.users.deactivate}>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{id.users.deactivate}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{id.users.deactivateConfirm}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                {id.users.cancel}
              </Button>
              <Button variant="danger" onPress={confirmDeactivate}>
                {id.users.deactivate}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
}
