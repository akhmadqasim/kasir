import * as React from "react"
import { NavLink, useLocation } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

type NavItem = {
  title: string
  url: string
  icon: React.ReactNode
  items?: {
    group?: string
    title: string
    url: string
  }[]
}

export function NavMain({ items }: { items: NavItem[] }) {
  const location = useLocation()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Menu</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) =>
          item.items ? (
            <Collapsible
              key={item.title}
              asChild
              defaultOpen={location.pathname.startsWith(item.url)}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((sub, i) => (
                      <React.Fragment key={sub.url}>
                        {sub.group && (i === 0 || sub.group !== item.items![i - 1].group) && (
                          <li className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {sub.group}
                          </li>
                        )}
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            asChild
                            isActive={location.pathname === sub.url}
                          >
                            <NavLink to={sub.url}>
                              <span>{sub.title}</span>
                            </NavLink>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </React.Fragment>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={location.pathname === item.url}
              >
                <NavLink to={item.url}>
                  {item.icon}
                  <span>{item.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
