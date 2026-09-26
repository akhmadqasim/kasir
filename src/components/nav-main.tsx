import * as React from "react"
import { useLocation } from "react-router-dom"
import { Disclosure } from "@heroui/react"

import {
  SidebarGroup,
  SidebarLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuLink,
  SidebarSubMenu,
  SidebarSubMenuLink,
} from "@/components/layout/sidebar"
import { sidebarMenuButtonClass, useSidebar } from "@/components/layout/sidebar-context"
import { isPathWithin } from "@/app/resume-route"
import type { NavItem, NavSubItem } from "@/app/navigation"

export function NavMain({ items, className }: { items: NavItem[]; className?: string }) {
  const location = useLocation()

  return (
    <SidebarGroup className={className}>
      <SidebarMenu>
        {items.map((item) =>
          item.items ? (
            <NavGroupItem
              key={item.title}
              item={item}
              items={item.items}
              pathname={location.pathname}
            />
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
          ),
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}

/**
 * A menu entry with children. `Disclosure` carries the `aria-expanded` /
 * `aria-controls` wiring, so the sub-menu is announced as a group rather than as
 * eleven loose links.
 *
 * Controlled rather than `defaultExpanded`, for two reasons:
 *
 *   - Reaching a report from somewhere else (a dashboard link, the resume route)
 *     opens its section, so the highlighted leaf is never hidden inside a
 *     folded group.
 *   - On the collapsed rail the sub-menu is not drawn at all, so pressing the
 *     trigger used to flip an invisible state and do nothing a keyboard user
 *     could see. There it pins the sidebar open with the section unfolded.
 *
 * While the rail is collapsed, the trigger also takes the active card when the
 * current page sits in its section — otherwise nothing on the rail says where
 * the cashier is.
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
  const { state, isMobile, pinSidebar } = useSidebar()
  const isWithin = isPathWithin(pathname, item.url)
  const isRail = state === "collapsed" && !isMobile
  const [isExpanded, setIsExpanded] = React.useState(isWithin)

  // Open the section when navigation lands inside it; never close it on the
  // way out — the cashier may have opened it on purpose.
  const [openedFor, setOpenedFor] = React.useState(pathname)
  if (openedFor !== pathname) {
    setOpenedFor(pathname)
    if (isWithin && !isExpanded) setIsExpanded(true)
  }

  const handleExpandedChange = (next: boolean) => {
    if (isRail) {
      pinSidebar()
      setIsExpanded(true)
      return
    }
    setIsExpanded(next)
  }

  return (
    <SidebarMenuItem>
      <Disclosure isExpanded={isExpanded} onExpandedChange={handleExpandedChange}>
        <Disclosure.Trigger
          className={sidebarMenuButtonClass("default", isWithin ? "text-foreground" : undefined)}
          data-active={isRail && isWithin}
        >
          {item.icon}
          <SidebarLabel className="truncate">{item.title}</SidebarLabel>
          <Disclosure.Indicator className="group-data-[state=collapsed]/sidebar:hidden" />
        </Disclosure.Trigger>
        <Disclosure.Content>
          <SidebarSubMenu>
            {items.map((subItem, index) => (
              <React.Fragment key={subItem.url}>
                {subItem.group && (index === 0 || subItem.group !== items[index - 1].group) && (
                  <li className="px-2 pt-2 pb-1 text-xs font-medium text-muted">{subItem.group}</li>
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
