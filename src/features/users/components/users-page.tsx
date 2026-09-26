import { useState, useMemo } from "react"
import {
  PlusIcon,
  PencilIcon,
  SearchXIcon,
  UserXIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react"
import { AlertDialog, Button, Spinner, Table } from "@heroui/react"

import { InfoPanel } from "@/components/info-panel"
import { NavbarActions } from "@/components/layout/app-navbar"
import { LoadError } from "@/components/load-error"
import { NoData } from "@/components/no-data"
import { TableSkeletonRows } from "@/components/table-skeleton-rows"
import { PendingButton } from "@/components/pending-button"
import { SummaryList } from "@/components/summary-list"
import { SearchInput } from "@/components/search-input"
import { StatusBadge } from "@/components/status-badge"
import { id } from "@/i18n/id"
import { useAuthStore } from "@/features/auth"
import { cn } from "@/lib/utils"
import { useUsers, useToggleUserActive } from "../hooks/use-users"
import { roleLabel } from "@/lib/labels"
import { UserFormDialog } from "./user-form-dialog"
import type { User } from "@/features/auth/types"

const COLUMN_COUNT = 6

export function UsersPage() {
  const currentUser = useAuthStore((s) => s.user)
  const { data: users, isLoading, isFetching, isError, error, refetch } = useUsers()
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
    if (toggleActive.isPending) return
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

  /** The row whose activation request is in flight, for its spinner. */
  const togglingUserId = toggleActive.isPending ? toggleActive.variables?.userId : undefined

  const renderEmptyState = () =>
    isError ? (
      <LoadError isRetrying={isFetching} title={id.loadFailed.users} onRetry={() => void refetch()}>
        {error?.message ?? id.common.error}
      </LoadError>
    ) : search ? (
      <NoData icon={<SearchXIcon />} title={id.noMatch.users}>
        {id.users.noMatchHint}
      </NoData>
    ) : (
      <NoData icon={<UsersIcon />} title={id.users.noUsers} />
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

      <SearchInput
        aria-label={id.users.searchPlaceholder}
        className="max-w-sm"
        placeholder={id.users.searchPlaceholder}
        value={search}
        onChange={setSearch}
      />

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
              {isLoading ? (
                <TableSkeletonRows columns={COLUMN_COUNT} rows={3} />
              ) : (
                filteredUsers.map((user, index) => (
                  // Inactive rows are muted through the text token on each cell
                  // (`.table__cell` sets its own colour), not `opacity-50`:
                  // half-opacity text falls far below AA, and the status badge
                  // already says "Nonaktif" in words.
                  <Table.Row key={user.id} id={user.id} textValue={user.username}>
                    <Table.Cell className={cn("tabular-nums", !user.is_active && "text-muted")}>
                      {index + 1}
                    </Table.Cell>
                    <Table.Cell className={cn("font-medium", !user.is_active && "text-muted")}>
                      {user.username}
                      {user.id === currentUser?.id && (
                        <span className="ms-1.5 font-normal text-muted">{id.common.you}</span>
                      )}
                    </Table.Cell>
                    <Table.Cell className={cn(!user.is_active && "text-muted")}>
                      {user.full_name}
                    </Table.Cell>
                    {/* Peran adalah kategori, bukan status: teks polos (DESIGN.md §5.4). */}
                    <Table.Cell className={cn(!user.is_active && "text-muted")}>
                      {roleLabel(user.role)}
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge status={user.is_active ? "success" : "neutral"}>
                        {user.is_active ? id.users.active : id.users.inactive}
                      </StatusBadge>
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      {/* Aksi baris mengikuti contoh "Custom Cells" tabel HeroUI:
                            `tertiary` untuk aksi biasa, `danger-soft` untuk yang
                            merusak (DESIGN.md §5.4). */}
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          aria-label={`${id.common.edit} ${user.username}`}
                          isIconOnly
                          size="sm"
                          variant="tertiary"
                          onPress={() => handleEdit(user)}
                        >
                          <PencilIcon />
                        </Button>
                        {user.id !== currentUser?.id && (
                          <Button
                            aria-label={`${user.is_active ? id.users.deactivate : id.users.activate} ${user.username}`}
                            isIconOnly
                            isPending={togglingUserId === user.id}
                            size="sm"
                            variant={user.is_active ? "danger-soft" : "tertiary"}
                            onPress={() => handleToggleActive(user)}
                          >
                            {({ isPending }) =>
                              isPending ? (
                                <Spinner color="current" size="sm" />
                              ) : user.is_active ? (
                                <UserXIcon />
                              ) : (
                                <UserCheckIcon />
                              )
                            }
                          </Button>
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <UserFormDialog open={formOpen} onOpenChange={setFormOpen} user={editingUser} />

      {/* Escape stays off while the request runs, like the disabled Cancel. */}
      <AlertDialog.Backdrop
        isKeyboardDismissDisabled={toggleActive.isPending}
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
              {/* Names the account: the row that opened this dialog is hidden
                  behind the backdrop. */}
              {deactivateUser && (
                <InfoPanel>
                  <SummaryList
                    layout="grid"
                    items={[
                      { label: id.users.username, value: deactivateUser.username },
                      { label: id.users.fullName, value: deactivateUser.full_name },
                    ]}
                  />
                </InfoPanel>
              )}
              <p>{id.users.deactivateNote}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button isDisabled={toggleActive.isPending} slot="close" variant="tertiary">
                {id.common.cancel}
              </Button>
              <PendingButton
                isPending={toggleActive.isPending}
                variant="danger"
                onPress={confirmDeactivate}
              >
                {id.users.deactivate}
              </PendingButton>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  )
}
