import * as React from "react"
import { useLocation } from "react-router-dom"
import { Disclosure } from "@heroui/react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuLink,
  SidebarSubMenu,
  SidebarSubMenuLink,
} from "@/components/layout/sidebar"
import { sidebarMenuButtonClass } from "@/components/layout/sidebar-context"
import { isPathWithin } from "@/app/resume-route"

type NavSubItem = {
  group?: string
  title: string
  url: string
}

type NavItem = {
  title: string
  url: string
  icon: React.ReactNode
  items?: NavSubItem[]
}

export function NavMain({ items }: { items: NavItem[] }) {
  const location = useLocation()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Menu</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) =>
          item.items ? (
            <NavGroupItem key={item.title} item={item} items={item.items} pathname={location.pathname} />
          ) : (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuLink
                to={item.url}
                tooltip={item.title}
                isActive={isPathWithin(location.pathname, item.url)}
              >
                {item.icon}
                <SidebarLabel className="truncate">{item.title}</SidebarLabel>
              </SidebarMenuLink>
            </SidebarMenuItem>
          )
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}

/**
 * A menu entry with children. `Disclosure` carries the `aria-expanded` /
 * `aria-controls` wiring, so the sub-menu is announced as a group rather than as
 * eleven loose links.
 */
function NavGroupItem({
  item,
  items,
  pathname,
}: {
  item: NavItem
  items: NavSubItem[]
  pathname: string
}) {
  return (
    <SidebarMenuItem>
      <Disclosure defaultExpanded={isPathWithin(pathname, item.url)}>
        <Disclosure.Trigger className={sidebarMenuButtonClass()}>
          {item.icon}
          <SidebarLabel className="truncate">{item.title}</SidebarLabel>
          <Disclosure.Indicator className="group-data-[state=collapsed]/sidebar:hidden" />
        </Disclosure.Trigger>
        <Disclosure.Content>
          <SidebarSubMenu>
            {items.map((subItem, index) => (
              <React.Fragment key={subItem.url}>
                {subItem.group && (index === 0 || subItem.group !== items[index - 1].group) && (
                  <li className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {subItem.group}
                  </li>
                )}
                <li>
                  <SidebarSubMenuLink to={subItem.url} isActive={pathname === subItem.url}>
                    <span className="truncate">{subItem.title}</span>
                  </SidebarSubMenuLink>
                </li>
              </React.Fragment>
            ))}
          </SidebarSubMenu>
        </Disclosure.Content>
      </Disclosure>
    </SidebarMenuItem>
  )
}
