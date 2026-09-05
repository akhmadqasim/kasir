import * as React from "react"
import { useLocation } from "react-router-dom"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuLink,
} from "@/components/layout/sidebar"
import { isPathWithin } from "@/app/resume-route"

type NavItem = {
  title: string
  url: string
  icon: React.ReactNode
}

export function NavSecondary({ items, className }: { items: NavItem[]; className?: string }) {
  const location = useLocation()

  return (
    <SidebarGroup className={className}>
      <SidebarGroupLabel>Admin</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuLink
              to={item.url}
              size="sm"
              tooltip={item.title}
              isActive={isPathWithin(location.pathname, item.url)}
            >
              {item.icon}
              <SidebarLabel className="truncate">{item.title}</SidebarLabel>
            </SidebarMenuLink>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
