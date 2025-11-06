# Route History Implementation for Workspace Windows

## Overview
Implemented proper back button (�) navigation for workspace windows that tracks route history and navigates through previously visited pages instead of always returning to workspace root.

## Files Modified

### Single File Change
**File:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/views/workspace/workspace.js`

**Note:** NO changes to Frappe's core router (`/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/router.js`)

---

## Implementation Summary

### 1. Initialize Route History (Line 1519-1520)
**Location:** `open_workspace_window()` method

**What:** Initialize empty route history array when window is created

```javascript
// Initialize route history for back button navigation
$window.attr("data-routes-history", "[]");
```

**Why:** Store history as JSON array in DOM attribute for easy inspection and persistence per window

---

### 2. Hook Router to Capture Routes (Lines 1801-1835)
**Location:** `setup_window_routing()` method

**What:** Wrap `frappe.router.push_state()` to capture current URL before navigation

```javascript
// Store original method
if (!frappe.router._original_push_state) {
    frappe.router._original_push_state = frappe.router.push_state.bind(frappe.router);
}

// Wrap push_state to capture current route before URL changes
frappe.router.push_state = function(url) {
    if (self.active_workspace_window && self.active_workspace_window.is(":visible")) {
        // Check navigating-back flag
        if (self.active_workspace_window.data("navigating-back")) {
            // Skip saving during back navigation
        } else {
            // Capture CURRENT URL before it changes
            const currentUrl = window.location.href.split(window.location.origin)[1];

            // Save to history if different from last
            let history = JSON.parse(self.active_workspace_window.attr("data-routes-history") || "[]");
            if (history.length === 0 || history[history.length - 1] !== currentUrl) {
                history.push(currentUrl);
                $window.attr("data-routes-history", JSON.stringify(history));
            }
        }
    }

    return frappe.router._original_push_state(url);
};
```

**Key Points:**
- Hooks at `push_state()` - perfect timing to capture OLD URL before it changes
- Uses `window.location.href.split(window.location.origin)[1]` to get path like `/app/users`
- Only activates when workspace window is active
- Prevents duplicates in history
- Respects `navigating-back` flag to avoid pollution during back navigation

---

### 3. Navigate Back Through History (Lines 1947-2003)
**Location:** `show_workspace_content_in_window()` method (back button handler)

**What:** Pop from history and navigate back, with special handling for workspace routes

```javascript
show_workspace_content_in_window($window) {
    let routesHistory = JSON.parse($window.attr("data-routes-history") || "[]");

    if (routesHistory.length > 0) {
        const previousRoute = routesHistory.pop();
        $window.attr("data-routes-history", JSON.stringify(routesHistory));

        const workspaceRoute = /* calculate workspace route */;

        if (previousRoute === workspaceRoute) {
            // Case 1: Going back to workspace - show content directly
            $content.find(".window-page-view").remove();
            $content.find(".desk-page").show();
            $window.find(".btn-window-back").hide();
            window.history.pushState(null, null, workspaceRoute);
            return;
        }

        // Case 2: Going back to other page - navigate normally
        $window.data("navigating-back", true);  // Set flag
        const routeParts = previousRoute.replace('/app/', '').split('/');
        frappe.set_route(routeParts);
        return;
    }

    // No history - show workspace content (existing logic)
}
```

**Key Points:**
- Two cases handled:
  1. **Workspace routes** (`/app/users`): Show workspace content directly, no routing
  2. **Other routes** (`/app/user`): Use `frappe.set_route()` to navigate
- Sets `navigating-back` flag before routing to prevent re-saving
- Updates URL manually for workspace routes to avoid circular reference

---

### 4. Prevent Circular References (Lines 1893-1908)
**Location:** `show_page_in_window()` method

**What:** Block attempts to show Workspaces page inside a window

```javascript
// Prevent circular reference
if (label === 'Workspaces' || page === this.wrapper[0]) {
    console.log("Cannot show Workspaces page in a window (circular reference)");
    return;
}

// Double-check for circular reference
if ($.contains(page, $window[0])) {
    console.log("Cannot show page: circular reference detected");
    return;
}
```

**Why:** Prevents `HierarchyRequestError` when trying to append Workspaces page (which contains windows) inside a window

---

## How It Works

### Navigation Flow Example

**Scenario:** Open Users workspace � User List � Specific User Form

1. **Open workspace "Users"**
   - Route: `/app/users`
   - History: `[]`

2. **Click "User List" link**
   - `push_state()` called
   - Saves `/app/users` to history
   - Navigates to `/app/user`
   - History: `['/app/users']`

3. **Click specific user**
   - `push_state()` called
   - Saves `/app/user` to history
   - Navigates to `/app/user/john@example.com`
   - History: `['/app/users', '/app/user']`

4. **Click back (�)**
   - Pop `/app/user` from history
   - Not workspace route � Set flag � Navigate via `frappe.set_route(['user'])`
   - History: `['/app/users']`

5. **Click back (�) again**
   - Pop `/app/users` from history
   - IS workspace route � Show workspace content directly
   - History: `[]`

6. **Click back (�) again**
   - History empty � Show workspace content (already showing)

---

## Key Technical Decisions

### Why Hook `push_state()` Instead of `change_to()`?
**Answer:** Timing. At `push_state()` start, `window.location.href` still has OLD URL. By `change_to()`, URL already changed.

### Why Store as Path Strings (`'/app/user'`) Not Route Arrays (`['List', 'User']`)?
**Answer:**
- Simpler and more reliable
- Works for ALL route types (workspaces, lists, forms, reports, etc.)
- Matches actual URL structure
- Easy to inspect in DevTools

### Why Special Handling for Workspace Routes?
**Answer:** Workspace routes should show EditorJS content, not trigger routing. Routing would try to show "Workspaces" page in window � circular reference error.

### Why Use `navigating-back` Flag?
**Answer:** Prevent route pollution. Without it, back navigation triggers `push_state()` again, saving the target route to history.

---

## Important Notes

### Route Format
Routes stored as **full paths** with `/app` prefix:
-  `'/app/users'`
-  `'/app/user'`
-  `'/app/user/john@example.com'`
- L NOT `['users']` or `['List', 'User']`

### Frappe Built-in Functions Used
- `frappe.router.push_state(url)` - Changes URL and triggers routing
- `frappe.set_route(parts)` - Navigate to route (accepts array)
- `frappe.router.slug(name)` - Convert name to URL slug
- `window.location.href.split(window.location.origin)[1]` - Get current path

### Console Logging
Implementation includes console.log for debugging:
- `"Route saved: /app/users"`
- `"Navigating back - skipping route save"`
- `"Going back to workspace - showing workspace content"`
- `"Cannot show Workspaces page in a window (circular reference)"`

Can be removed in production if desired.

---

## Testing Checklist

- [x] Navigate forward through multiple pages - history builds correctly
- [x] Click back button - navigates to previous page
- [x] Click back multiple times - goes through full history
- [x] Click back to workspace - shows workspace content (not error)
- [x] Click back when history empty - stays at workspace
- [x] No duplicate routes in history
- [x] No circular reference errors
- [x] URL updates correctly during navigation

---

## Future Enhancements

### Possible Improvements
1. **Browser back/forward buttons:** Currently only works with window's � button. Could hook `popstate` event.
2. **Persist history:** Store in localStorage to survive page refresh
3. **History limit:** Cap at N routes to prevent memory issues
4. **Breadcrumb integration:** Update breadcrumb to show full path

### If Issues Arise
1. Check console logs for route saves/navigation
2. Inspect window's `data-routes-history` attribute in DevTools
3. Verify `navigating-back` flag is cleared properly
4. Ensure workspace route comparison is correct (check slug)
