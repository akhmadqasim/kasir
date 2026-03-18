import { useState } from "react"
import { Pencil, Trash2, Plus } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { id } from "@/i18n/id"
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "../hooks/use-categories"
import type { Category } from "../types"

interface CategoryManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CategoryManager({ open, onOpenChange }: CategoryManagerProps) {
  const { data: categories } = useCategories()
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const deleteCategory = useDeleteCategory()

  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editName, setEditName] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)

  const handleCreate = () => {
    if (!newName.trim()) return
    createCategory.mutate(
      { name: newName.trim(), description: newDesc.trim() || undefined },
      {
        onSuccess: () => {
          setNewName("")
          setNewDesc("")
        },
      }
    )
  }

  const handleStartEdit = (category: Category) => {
    setEditingCategory(category)
    setEditName(category.name)
    setEditDesc(category.description || "")
  }

  const handleSaveEdit = () => {
    if (!editingCategory || !editName.trim()) return
    updateCategory.mutate(
      {
        id: editingCategory.id,
        name: editName.trim(),
        description: editDesc.trim() || undefined,
      },
      { onSuccess: () => setEditingCategory(null) }
    )
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    deleteCategory.mutate(
      { id: deleteTarget.id },
      { onSettled: () => setDeleteTarget(null) }
    )
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{id.products.manageCategories}</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="space-y-3">
              <Label>{id.products.addCategory}</Label>
              <Input
                placeholder={id.products.categoryName}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Textarea
                placeholder={id.products.categoryDesc}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
              />
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!newName.trim() || createCategory.isPending}
              >
                <Plus className="mr-2 h-4 w-4" />
                {id.products.addCategory}
              </Button>
            </div>

            <Separator />

            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {categories?.map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    {editingCategory?.id === category.id ? (
                      <div className="flex-1 space-y-2 mr-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder={id.products.categoryName}
                        />
                        <Textarea
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder={id.products.categoryDesc}
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={!editName.trim() || updateCategory.isPending}
                          >
                            {id.common.save}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingCategory(null)}
                          >
                            {id.common.cancel}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{category.name}</p>
                          {category.description && (
                            <p className="text-sm text-muted-foreground truncate">
                              {category.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleStartEdit(category)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(category)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {(!categories || categories.length === 0) && (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    {id.products.noProducts}
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{id.common.confirm}</AlertDialogTitle>
            <AlertDialogDescription>
              {id.products.deleteCategoryConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{id.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {id.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
