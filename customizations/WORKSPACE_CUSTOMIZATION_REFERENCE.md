# Frappe Workspace Customization Documentation

## Overview
This document explains all customizations made to the Frappe workspace system to allow users to edit their own private workspaces without requiring the "Workspace Manager" role, while restricting public workspace sidebar customization to managers only.

---

## 📋 Summary of Changes

### Objective
Allow regular users (with desk access) to:
- ✅ Create and edit their own private workspaces
- ✅ Customize their private workspace sidebars
- ✅ Drag and reorder sidebar links in private workspaces

While preventing:
- ❌ Non-managers from editing public workspace content
- ❌ Non-managers from customizing public workspace sidebars
- ❌ Non-managers from seeing the edit button on public workspaces

---

## 📁 Files Modified

### 1. **Frontend - Workspace Management File**

**Path:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/views/workspace/workspace.js`

This is the main JavaScript file that handles all workspace UI interactions, editing, and customization.

**Language:** JavaScript (ES6+)

**Type:** Client-side UI logic

**Lines Modified:** ~50 lines across multiple functions

---

## 🔧 Functions Modified

### Function 1: `setup_pages()` - Line 179-193

**Purpose:** Initializes workspace pages and determines edit permissions for each page

**What it does:**
- Fetches all workspace pages from the backend
- Caches page data
- **MODIFIED:** Determines if each page is editable based on:
  - For **private workspaces**: User must be the owner (`page.for_user === frappe.session.user`)
  - For **public workspaces**: Only Workspace Manager can edit (`this.has_access`)

**Key Code Change:**
```javascript
// Line 189 - MODIFIED
page.is_editable = (!page.public && page.for_user === frappe.session.user) || this.has_access;
```

**Original Code:**
```javascript
page.is_editable = !page.public || this.has_access;
```

**Why Changed:** Original code allowed ANY user to edit ANY private workspace. New code restricts editing to the owner or managers.

---

### Function 2: `open_workspace_window()` - Line 1611-1735

**Purpose:** Opens a workspace in a new floating window with content editor and sidebar

**What it does:**
- Creates a new workspace window container
- Sets up window controls (minimize, maximize, close, edit buttons)
- Loads workspace content from backend
- Loads sidebar links for the workspace

**Key Code Change (Line 1633):**
```javascript
// MODIFIED - Hide edit button for non-managers on public workspaces
<button class="btn-window-edit" title="Edit Workspace"
        style="${page.public && !this.has_access ? 'display: none;' : ''}">✎</button>
```

**Why Changed:** Prevents users without the Workspace Manager role from seeing the edit button on public workspaces.

---

### Function 3: `save_main_workspace()` - Line 1821-1886

**Purpose:** Saves workspace content (EditorJS blocks) to the backend

**What it does:**
- Collects edited blocks from the EditorJS editor
- Extracts new widgets that were added
- Calls backend API to save changes
- Shows success/error messages

**Key Code Change (Line 1848):**
```javascript
// MODIFIED - Send only title, not the full workspace name
args: {
    title: page.title,  // Changed from page.name
    public: page.public ? 1 : 0,
    new_widgets: new_widgets,
    blocks: JSON.stringify(blocks)
},
```

**Why Changed:** The `save_page()` backend method expects only the title. For private workspaces, the full `page.name` includes the suffix `-{username}`, which the backend reconstructs from the `for_user` field.

---

### Function 4: `toggle_window_edit_mode()` - Line 3027-3082

**Purpose:** Enters/exits edit mode for workspace content and sidebar

**What it does:**
- Toggles the editor between read-only and edit modes
- Handles sidebar edit mode (only for private workspaces)
- Shows appropriate messages to the user

**Key Code Changes (Lines 3063-3077):**
```javascript
// MODIFIED - Only enter sidebar edit mode for private workspaces
if (!page.public) {
    this.enter_sidebar_edit_mode($window, page);

    frappe.show_alert({
        message: __("Edit mode enabled (workspace + sidebar)"),
        indicator: "blue"
    });
} else {
    // For public workspaces, only allow content editing, not sidebar customization
    frappe.show_alert({
        message: __("Edit mode enabled (content only)"),
        indicator: "blue"
    });
}
```

**Why Changed:** Public workspaces should use default sidebar links that cannot be customized by regular users.

---

### Function 5: `save_both_workspace_and_sidebar()` - Line 3118-3138

**Purpose:** Saves both workspace content AND sidebar customizations

**What it does:**
- Saves workspace content changes
- Saves sidebar customizations (links, order, etc.)
- Exits edit mode after successful save

**Key Code Change (Lines 3123-3131):**
```javascript
// MODIFIED - Only save sidebar customizations for private workspaces
if (!page.public) {
    this.save_sidebar_customizations($window, page);

    const $sidebar = $window.find(".window-sidebar");
    $sidebar.removeClass("edit-mode");
}
```

**Why Changed:** Prevents any sidebar modifications from being saved for public workspaces.

---

### Function 6: `render_sidebar()` - Line 2146-2241

**Purpose:** Renders the sidebar links in the workspace window

**What it does:**
- Retrieves sidebar links from backend
- Creates DOM elements for each link
- Makes links draggable (for private workspaces only)
- Sets up click handlers for navigation

**Key Code Changes (Lines 2196, 2199):**
```javascript
// MODIFIED - Add conditional draggable class
const is_custom_class = link.is_custom ? 'is-custom-link' : '';
const is_draggable_class = !page.public ? 'is-draggable' : '';

const link_html = `
    <div class="sidebar-link ${is_draggable_class} ${is_custom_class}">
```

**Why Changed:** Only private workspaces should have draggable sidebar links. Public workspace links should be read-only.

---

### Function 7: `setup_sidebar_sortable()` - Line 2278-2297

**Purpose:** Enables drag-and-drop reordering of sidebar links

**What it does:**
- Initializes Sortable.js library
- Sets up drag handles for links
- Saves new order after drag completes

**Key Code Change (Line 2283):**
```javascript
// MODIFIED - Skip sortable setup for public workspaces
if (page.public || !$linksContainer.length) return;
```

**Why Changed:** Prevents drag-and-drop reordering in public workspaces where sidebar is not customizable.

---

## 🗂️ Backend Files (Not Modified - For Reference)

### File 1: **Backend Workspace Logic**

**Path:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace/workspace.py`

**Language:** Python

**Relevant Methods:**

#### `update_page()` - Line 308-350
- **Purpose:** Updates workspace properties (title, icon, color, parent, public status)
- **Permission Check:** `if not doc.get("public") and doc.get("for_user") != frappe.session.user and not is_workspace_manager()`
- **Key Point:** Prevents non-owners from editing other users' private workspaces

#### `delete_page()` - Line 413-435
- **Purpose:** Deletes a workspace
- **Permission Check:** Prevents non-owners from deleting other users' private workspaces
- **Backend Validation:** Essential for security - frontend can't bypass this

#### `save_page()` - Line 286-304
- **Purpose:** Saves workspace content (EditorJS blocks)
- **Filter Logic:** For private workspaces, filters by `for_user == frappe.session.user`
- **Key Point:** Allows only the owner to save their private workspace content

#### `hide_unhide_page()` - Line 353-366
- **Purpose:** Hides or unhides workspaces
- **Permission Check:** Ensures non-owners can't modify other users' private workspaces

#### `is_workspace_manager()` - Not a defined method but used throughout
- **Purpose:** Checks if user has "Workspace Manager" role
- **Implementation:** `"Workspace Manager" in frappe.get_roles()`

### File 2: **Desktop/Sidebar Functions**

**Path:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/desktop.py`

**Language:** Python

**Relevant Methods:**

#### `get_workspace_sidebar_items()` - Line 488-550
- **Purpose:** Returns list of workspaces user can access
- **Key Line:** `has_access = "Workspace Manager" in frappe.get_roles()` (Line 490)
- **What it does:**
  - Determines if user is a Workspace Manager
  - Returns all workspaces (public + private for this user)
  - Passes `has_access` flag to frontend
- **Frontend Usage:** Frontend stores this as `this.has_access` to control UI visibility

#### `get_user_sidebar_links()` - Line 757-852
- **Purpose:** Retrieves sidebar links for a workspace
- **What it does:**
  - Gets custom sidebar if user customized it (Workspace User Sidebar doctype)
  - Falls back to default sidebar from workspace definition
  - Filters links based on user permissions
  - Returns permission flags to frontend
- **Frontend Usage:** Frontend uses returned links to render sidebar

#### `save_user_sidebar()` - Line 865-916
- **Purpose:** Saves custom sidebar configuration for a workspace
- **Permission Check:** Validates user has permission to customize
- **Key Point:** Only allows customization of private workspaces for the owner
- **What it saves:** Custom link order, added links, removed links

#### Helper Functions (Not directly used but referenced):
- `has_permission_for_sidebar_link()` - Validates link permissions
- `_check_link_permission()` - Core permission checking for links

---

## 💾 Doctypes Used

### 1. **Workspace** (Core Doctype - Not Created, Only Modified Behavior)

**Document Type Name:** `Workspace`

**Location:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace/`

**Type:** Standard DocType

**Key Fields:**
- `name` - Workspace identifier
  - Format for public: `"Home"`, `"Dashboard"`
  - Format for private: `"Dashboard-user@example.com"`
- `title` - Display name (e.g., "Dashboard")
- `label` - Full label (name or name-user)
- `public` (Check) - Boolean flag: 1 for public, 0 for private
- `for_user` (Link to User) - Username for private workspaces, empty for public
- `content` (Long Text) - EditorJS JSON blocks for workspace content
- `links` (Table - Workspace Link) - Shortcuts/links displayed in workspace
- `icon` (Link) - Icon for the workspace
- `indicator_color` - Color indicator for the workspace
- `parent_page` - Parent workspace for nested workspaces
- `is_hidden` - Flag to hide workspace from sidebar
- `module` - Module the workspace belongs to
- `restrict_to_domain` - Domain restriction

**Permission Model:**
- Public workspaces: Only Workspace Manager can edit
- Private workspaces: Owner can edit, Workspace Manager can edit any
- All users can view (based on permissions)

**Customization Impact:**
- Frontend now allows regular users to edit their private workspaces
- Sidebar customization restricted to private workspaces only
- Default sidebar links used for public workspaces

**Related Records:**
- One Workspace document per workspace
- Can have multiple child Workspace documents (parent_page relationship)

### 2. **Workspace User Sidebar** (DocType - For Custom Sidebar Storage)

**Document Type Name:** `Workspace User Sidebar`

**Location:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace_user_sidebar/`

**Type:** Standard DocType

**Purpose:** Stores customized sidebar configurations per user per workspace

**Key Fields:**
- `workspace` (Link to Workspace) - Which workspace this sidebar is for
- `user` (Link to User) - Which user customized it
- `links` (Table - Workspace User Sidebar Link) - Custom links in custom order
  - Each link has: `link_type`, `link_to`, `label`, `icon`, `idx`
- `is_customized` (Check) - Flag indicating customization exists

**Document Naming:**
- Format: `{workspace_name}-{username}`
- Example: `Dashboard-user@example.com`

**Customization Impact:**
- Only created/modified for private workspaces
- Prevents creation for public workspaces via frontend validation
- Backend method `save_user_sidebar()` creates/updates this

**Data Relationship:**
- Many-to-one relationship with Workspace (one workspace has many custom sidebars, one per user)
- Each user with customized sidebar has one document

### 3. **Workspace Link** (Child Table - Part of Workspace DocType)

**Document Type Name:** `Workspace Link`

**Type:** Child Table (part of Workspace)

**Purpose:** Defines default links/shortcuts for a workspace

**Key Fields:**
- `link_type` (Link, Select) - Type of link: DocType, Page, Report, URL, etc.
- `link_to` (Data) - Target (DocType name, Page name, Report name, or URL)
- `label` (Data) - Display label for the link
- `icon` (Link) - Icon to display
- `description` - Tooltip description
- `is_query_report` (Check) - If Report, whether it's a query report
- `report_ref_doctype` - Reference DocType for reports

**Customization Impact:**
- Public workspaces use these default links exclusively
- Private workspaces can have these overridden by Workspace User Sidebar
- Frontend prevents modification of these for public workspaces

---

## 🔐 Permission Model Summary

| Scenario | User Type | Can Edit Content | Can Edit Sidebar | Shows Edit Button | Backend Check |
|----------|-----------|------------------|------------------|-------------------|---|
| Private Workspace (Owner) | Owner | ✅ Yes | ✅ Yes | ✅ Yes | `for_user == user` |
| Private Workspace (Other User) | Non-Owner | ❌ No | ❌ No | ❌ No | `for_user != user` → Error |
| Private Workspace (Manager) | Workspace Manager | ✅ Yes | ✅ Yes | ✅ Yes | `is_workspace_manager()` |
| Public Workspace (Manager) | Workspace Manager | ✅ Yes | ❌ No | ✅ Yes | `is_workspace_manager()` |
| Public Workspace (Regular User) | Regular User | ❌ No | ❌ No | ❌ No | Permission error |

---

## 🔄 Workflow: Creating & Editing Private Workspace

### User Creates Private Workspace:

1. **Frontend** - `create_page()` function (Line ~1000)
   - User fills in workspace title, icon, color, parent page
   - Workspace name auto-generated: `{title}-{frappe.session.user}`
   - `for_user` set to `frappe.session.user`
   - `is_editable` set to `true` (since owner)
   - Calls backend `save_page()` via frappe.call

2. **Backend** - `save_page()` method (workspace.py:286)
   - Creates new Workspace document
   - Sets `for_user = frappe.session.user`
   - Sets `public = 0`
   - Saves with `ignore_permissions=True` (safe because permission checked upstream)
   - Clears cache for user's bootinfo via `doc.clear_cache()`

3. **Frontend** - Workspace appears in sidebar
   - `setup_pages()` re-runs
   - User sees their workspace in "Personal" category
   - `is_editable = true` (because owner)
   - Can immediately edit content and sidebar

### User Edits Private Workspace Content:

1. **Frontend** - User clicks edit button (✎)
   - Calls `toggle_window_edit_mode($window, page)`
   - EditorJS enters edit mode via `editor.readOnly.toggle()`
   - **NEW:** Sidebar enters edit mode via `enter_sidebar_edit_mode()` (because `!page.public`)
   - Shows "Edit mode enabled (workspace + sidebar)" message

2. **User modifies content:**
   - Adds/removes/reorders blocks in editor
   - Can also add/remove/reorder sidebar links via drag-drop

3. **User saves (clicks 💾):**
   - Calls `save_both_workspace_and_sidebar($window, page, editor)`
   - **First:** `save_window_workspace()` saves content
     - Calls `save_page()` with `page.title` (NOT page.name)
     - Backend finds workspace: `{title}-{current_user}`
     - Content saved to `content` field
   - **Then:** `save_sidebar_customizations()` saves sidebar (because `!page.public`)
     - Collects all links from DOM
     - Calls `save_user_sidebar()` backend method
     - Backend creates/updates Workspace User Sidebar document
   - Success message shown
   - Edit mode exited

---

## 🔄 Workflow: Public Workspace (Workspace Manager Only)

### Workspace Manager Edits Public Workspace:

1. **Frontend** - Manager opens public workspace
   - Edit button visible (because `page.public && this.has_access` = false)

2. **Manager clicks edit button:**
   - Calls `toggle_window_edit_mode($window, page)`
   - EditorJS enters edit mode
   - **NEW:** Sidebar does NOT enter edit mode (because `page.public`)
   - Alert shows "Edit mode enabled (content only)"
   - Sidebar remains read-only with default links

3. **Manager edits content:**
   - Can modify blocks in editor
   - Cannot modify sidebar links (UI doesn't allow it)

4. **Manager saves:**
   - Only content saved via `save_window_workspace()`
   - Sidebar save skipped (because `page.public`)
   - Message confirms content saved
   - Edit mode exited

### Regular User Views Public Workspace:

1. **Frontend** - User opens public workspace
   - Edit button is **hidden** (because `page.public && !this.has_access` = true)

2. **User can only view:**
   - Workspace content (read-only)
   - Default sidebar links from Workspace Link table
   - Cannot interact with edit features

3. **Sidebar links:**
   - Fetched from default workspace links
   - Not draggable (no `is-draggable` class added in `render_sidebar()`)
   - Sortable not initialized (skipped in `setup_sidebar_sortable()`)
   - Read-only - clicking navigates, dragging doesn't work

---

## 📊 Data Flow Diagram

```
User Action
    ↓
Frontend (workspace.js)
    ↓
setup_pages() (Line 179)
    └─ Determine edit permissions for each page
    ↓
open_workspace_window() (Line 1611)
    └─ Render window with conditional edit button (Line 1633)
    ↓
build_window_sidebar() (Line 2121)
    └─ Fetch sidebar via backend get_user_sidebar_links()
    ↓
render_sidebar() (Line 2146)
    └─ Create DOM with conditional draggable class (Line 2196, 2199)
    ├─ setup_sidebar_navigation() (Line 2242)
    └─ setup_sidebar_sortable() (Line 2278) - conditional for private only (Line 2283)
    ↓
User interacts
    ├─ Click edit button? (visible only if editable)
    │   ↓
    │   toggle_window_edit_mode() (Line 3027)
    │   ├─ If private: enter_sidebar_edit_mode() (Line 3065)
    │   └─ If public: show content-only message (Line 3073)
    │   ↓
    │   User modifies & clicks save
    │   ↓
    │   save_both_workspace_and_sidebar() (Line 3118)
    │   ├─ save_window_workspace() → Backend save_page()
    │   └─ If private: save_sidebar_customizations() → Backend save_user_sidebar()
    │
    └─ Click sidebar link?
        ↓
        setup_sidebar_navigation() handler
        ↓
        frappe.set_route() - navigate to linked item
    ↓
Backend (desktop.py / workspace.py)
    ├─ get_user_sidebar_links() - fetch sidebar for this workspace
    ├─ save_page() - find workspace by title + for_user
    └─ save_user_sidebar() - save custom sidebar (with permission check)
    ↓
Frontend callback
    └─ Show success/error message
```

---

## 🐛 Testing Checklist for Future Developers

### **Private Workspace Owner:**
- [ ] Can create private workspace
- [ ] Can see edit button on their workspace
- [ ] Can edit workspace content
- [ ] Can customize sidebar (add/remove/reorder links)
- [ ] Saved changes persist
- [ ] Can delete their own workspace
- [ ] Cannot edit other user's private workspace

### **Private Workspace Non-Owner:**
- [ ] Cannot see edit button on other users' workspaces
- [ ] Cannot access edit mode on other user's workspace
- [ ] Cannot modify sidebar on other user's workspace
- [ ] Can view other user's workspace (if they have permission)
- [ ] Changes by owner don't affect their view

### **Public Workspace Workspace Manager:**
- [ ] Can see edit button on public workspaces
- [ ] Can edit workspace content
- [ ] Cannot edit sidebar (edit mode shows "content only")
- [ ] Sidebar shows default links from Workspace Link table
- [ ] Cannot drag-reorder sidebar links (draggable class not present)
- [ ] Saved changes persist for all users

### **Public Workspace Regular User:**
- [ ] Cannot see edit button
- [ ] Cannot access edit mode
- [ ] Can view content (read-only)
- [ ] Can view default sidebar links
- [ ] Can click sidebar links to navigate
- [ ] Cannot drag-reorder sidebar links

### **Permission Checks:**
- [ ] Backend prevents non-owner from saving other user's workspace content
- [ ] Backend prevents non-owner from customizing other user's sidebar
- [ ] Backend prevents sidebar customization on public workspaces
- [ ] Frontend and backend permission checks are in sync
- [ ] Workspace Manager can override all restrictions

### **Edge Cases:**
- [ ] User deletes their account → their workspaces still exist but for_user is orphaned
- [ ] User changes username → for_user field still references old username
- [ ] Workspace moved from private to public → sidebar customizations preserved
- [ ] Workspace moved from public to private → default sidebar becomes custom

---

## 🔍 Code References Quick Lookup

| Feature | Function | File | Line(s) |
|---------|----------|------|---------|
| Edit permission check | `setup_pages()` | workspace.js | 189 |
| Edit button visibility | `open_workspace_window()` | workspace.js | 1633 |
| Save workspace content | `save_main_workspace()` | workspace.js | 1848 |
| Edit mode toggle | `toggle_window_edit_mode()` | workspace.js | 3063-3077 |
| Save with conditions | `save_both_workspace_and_sidebar()` | workspace.js | 3123-3131 |
| Render sidebar | `render_sidebar()` | workspace.js | 2196, 2199 |
| Drag-drop setup | `setup_sidebar_sortable()` | workspace.js | 2283 |
| Backend sidebar fetch | `get_user_sidebar_links()` | desktop.py | 757 |
| Backend page save | `save_page()` | workspace.py | 286 |
| Backend permission check | `update_page()` | workspace.py | 312-316 |

---

## 🚀 Common Customization Points for Future Developers

### If You Need to Add More Permissions:

1. **Modify `setup_pages()` permission logic** (Line 189):
   ```javascript
   // Example: Add department-based access
   page.is_editable = (
       (!page.public && page.for_user === frappe.session.user) ||
       (user_departments.includes(workspace_department)) ||
       this.has_access
   );
   ```

2. **Update backend validation** in `workspace.py update_page()`:
   ```python
   # Add custom permission check before allowing save
   if not check_department_access(doc):
       frappe.throw(_("No access to this department's workspace"))
   ```

### If You Need to Change Edit Button Behavior:

1. **Modify `open_workspace_window()`** (Line 1633):
   ```javascript
   // Example: Hide button based on custom role
   style="${(page.public && !this.has_access) || !user_has_role('Editor') ? 'display: none;' : ''}"
   ```

2. **Consider backend `get_workspace_sidebar_items()`** to pass custom flags

### If You Need to Change Sidebar Rules:

1. **Modify `render_sidebar()`** (Lines 2196, 2199):
   ```javascript
   // Example: Allow sidebar customization only for certain roles
   const can_customize = !page.public && (page.for_user === frappe.session.user || has_custom_role);
   const is_draggable_class = can_customize ? 'is-draggable' : '';
   ```

2. **Update `setup_sidebar_sortable()`** (Line 2283) to match your new rules

3. **Update backend `save_user_sidebar()`** to validate new rules

### If You Need to Restrict Content Editing:

1. **Modify `toggle_window_edit_mode()`** (Line 3040):
   ```javascript
   // Add checks before entering edit mode
   if (!this.can_edit_workspace(page)) {
       frappe.show_alert({message: "Not allowed", indicator: "red"});
       return;
   }
   ```

2. **Backend `update_page()` already has permission checks** - implement matching logic

### If You Need to Add New Sidebar Link Types:

1. **Backend `get_user_sidebar_links()`** handles different link types
2. **Frontend `render_sidebar()`** has route determination logic (Lines 2182-2193)
3. **Add new type handling** in both places

---

## 📝 Important Notes

### 1. **Backend Permission Checks are Crucial:**
- Never trust frontend-only permissions
- Backend methods in `desktop.py` and `workspace.py` validate all operations
- Frontend changes only affect UI/UX, not actual security
- All backend changes have `ignore_permissions=True` but still validate ownership

### 2. **Title vs Name Distinction:**
- `page.title`: User-friendly name ("Dashboard")
- `page.name`: Full identifier ("Dashboard-user@example.com" for private, "Dashboard" for public)
- Always send `page.title` to `save_page()` method for both public and private workspaces
- Backend reconstructs full name from title + for_user field

### 3. **Cache Invalidation:**
- After saving workspace, `clear_cache()` is called on the Workspace document
- This clears the user's bootinfo if it's a private workspace
- Frontend should reload workspace list after save
- Important for frontend to get updated workspace permissions

### 4. **Permission Checks Location:**
- **Frontend:** Determines UI visibility (edit button, drag-drop, etc.)
- **Backend:** Enforces actual permissions (critical for security)
- Always implement both for security

### 5. **Editor Instance Management:**
- EditorJS editor stored on window element: `$window.data("workspace-editor", editor)`
- Important for multi-window workspaces to avoid conflicts
- Different from main workspace editor in old full-page mode

### 6. **Sidebar vs Content Storage:**
- **Workspace Content:** Stored in Workspace.content field (EditorJS JSON)
- **Sidebar Customization:** Stored in Workspace User Sidebar doctype
- Two separate save operations via `save_both_workspace_and_sidebar()`

---

## 🔗 Related Frappe Documentation

- [Workspace DocType](https://docs.frappe.io/user/manual/en/workspace)
- [Role Permissions](https://docs.frappe.io/user/manual/en/role)
- [Role Profile](https://docs.frappe.io/user/manual/en/role-profile)
- [EditorJS Documentation](https://editorjs.io/)
- [Sortable.js Documentation](https://sortablejs.github.io/Sortable/)

---

## 👤 Customization History

- **Date:** 2025-11-13
- **Purpose:** Allow users to edit their own private workspaces without Workspace Manager role
- **Modified By:** Development Team
- **Files Modified:** 1 file (workspace.js)
- **Lines Changed:** ~50 lines across 7 functions
- **Functions Modified:** 7
- **Doctypes Affected:** 2 (Workspace, Workspace User Sidebar)

---

## 📞 Support & Questions

For questions about these customizations:
1. **Check this document first** - most answers are here
2. **Review inline comments** in workspace.js (lines have comments explaining changes)
3. **Check backend logic** in desktop.py and workspace.py for permission validation
4. **Test against checklist** above to verify implementation
5. **Check Frappe logs** if something isn't working as expected

---

## 🎯 Quick Reference: What Changed & Why

| What Changed | Where | Why |
|---|---|---|
| `is_editable` logic | setup_pages():189 | To check workspace owner, not just private status |
| Edit button hidden | open_workspace_window():1633 | To hide button from non-managers on public workspaces |
| Title instead of name | save_main_workspace():1848 | Backend expects title, reconstructs full name |
| Sidebar edit conditional | toggle_window_edit_mode():3063 | To prevent sidebar editing for public workspaces |
| Sidebar save conditional | save_both_workspace_and_sidebar():3123 | To prevent sidebar customizations being saved for public |
| Draggable class conditional | render_sidebar():2196 | To prevent drag-drop on public workspace sidebars |
| Sortable skip for public | setup_sidebar_sortable():2283 | To disable reordering on public workspace sidebars |

---

## 📋 Feature #13: Workspace Sidebar Duplication on Copy

### Overview

When users duplicate a workspace (create a copy), the workspace sidebar is automatically copied using a smart three-tier priority system. This ensures the duplicated workspace is ready to use immediately with all sidebar customizations intact.

### Implementation

**File:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace/workspace.py`

**Functions:**
- `duplicate_page()` (line 380-414) - Main duplication function
- `copy_sidebar_on_duplicate()` (line 417-520) - Helper function for sidebar copying

### Three-Tier Sidebar Priority System

The function uses a cascading priority system to determine which sidebar to copy:

#### TIER 1: User Custom Sidebar (Highest Priority)

**Condition:** `Workspace User Sidebar` exists for the user + source workspace

**Fields Copied:**
- All sidebar links with their properties
- Hidden link preferences
- Link ordering/sequence

**Code Location:** Line 434-461

```python
source_custom_sidebar_name = frappe.db.get_value(
    "Workspace User Sidebar",
    {"user": target_user, "workspace": source_workspace_name},
    "name"
)
```

**Behavior:**
- Checks if user has customized sidebar on source
- Copies all links as-is with exact settings
- Returns immediately (highest priority wins)

---

#### TIER 2: Admin Default Sidebar

**Condition:** `Default Workspace Sidebar` exists for source workspace

**Fields Copied:**
- All default sidebar links
- Link labels and icons
- Link sequence/order

**Code Location:** Line 463-509

**Branch A: Public → Public Duplication**
```python
if is_public:
    if frappe.has_role("System Manager"):
        # Create new Default Workspace Sidebar for duplicated workspace
```

**Behavior:**
- Only System Managers can copy default sidebar to public workspace
- Creates `Default Workspace Sidebar` document for target
- Preserves admin configuration

**Branch B: Public → Private Duplication**
```python
else:
    # Convert default sidebar to user customization
    new_user_sidebar = frappe.new_doc("Workspace User Sidebar")
    new_user_sidebar.user = target_user
    new_user_sidebar.workspace = target_workspace_name
```

**Behavior:**
- Converts admin default to user customization
- Regular users get configured sidebar in private workspace
- Hidden links initialized to empty

---

#### TIER 3: Built-in Workspace Links (Fallback)

**Condition:** No custom or default sidebar exists

**Code Location:** Line 511-513

```python
# TIER 3: No custom or default sidebar exists
# The workspace.links are already copied by frappe.copy_doc()
# No additional action needed
```

**Behavior:**
- Framework automatically copies `workspace.links` table
- Built-in links from workspace definition used
- No additional action needed

### Duplication Scenarios & Results

#### Scenario 1: Public Workspace → Private Workspace

**Source:** Public workspace with default sidebar
**Target:** Private workspace
**Result:** Default sidebar converted to user customization

| Step | What Happens |
|---|---|
| 1 | Check for user custom sidebar on source (not found for public) |
| 2 | Check for admin default sidebar (found) |
| 3 | Create Workspace User Sidebar for target workspace |
| 4 | Copy all default sidebar links to user custom |
| 5 | Initialize hidden_default_links to empty |

**Code Path:** Lines 470-508

---

#### Scenario 2: Private Workspace → Private Workspace (Same User)

**Source:** Private workspace with user customization
**Target:** New private workspace
**Result:** User customization copied exactly

| Step | What Happens |
|---|---|
| 1 | Check for user custom sidebar on source (found) |
| 2 | Create Workspace User Sidebar for target |
| 3 | Copy all custom links with exact properties |
| 4 | Preserve hidden_default_links |
| 5 | Return (TIER 1 wins) |

**Code Path:** Lines 434-461

---

#### Scenario 3: Public Workspace → Public Workspace (System Manager)

**Source:** Public workspace with default sidebar
**Target:** New public workspace
**Result:** Admin default sidebar copied to new workspace

| Step | What Happens |
|---|---|
| 1 | Check for user custom sidebar (not found) |
| 2 | Check for admin default sidebar (found) |
| 3 | Check if user is System Manager (yes) |
| 4 | Create Default Workspace Sidebar for target |
| 5 | Copy all default links |

**Code Path:** Lines 473-489

---

#### Scenario 4: Public Workspace → Public Workspace (Regular User)

**Source:** Public workspace with admin default sidebar
**Target:** New public workspace
**Result:** Built-in links used (no admin default copied)

| Step | What Happens |
|---|---|
| 1 | Check for user custom sidebar (not found) |
| 2 | Check for admin default sidebar (found) |
| 3 | Check if user is System Manager (no) |
| 4 | Skip default sidebar copy |
| 5 | Use built-in workspace links (already copied) |

**Code Path:** Lines 473-489 (condition fails, skip)

---

#### Scenario 5: Workspace Without Sidebar Configuration

**Source:** Any workspace with no custom or default sidebar
**Target:** Any new workspace
**Result:** Built-in workspace links used

| Step | What Happens |
|---|---|
| 1 | Check for user custom sidebar (not found) |
| 2 | Check for admin default sidebar (not found) |
| 3 | Skip to TIER 3 |
| 4 | Use workspace.links (already copied by framework) |

**Code Path:** Lines 511-513

---

### Permission Model

**Who Can Duplicate?**

| User Type | Public WS | Private WS (Own) | Private WS (Other) |
|---|---|---|---|
| Regular User | ✅ (as private) | ✅ | ❌ |
| Workspace Manager | ✅ (as public) | ✅ (as public) | ❌ |
| System Manager | ✅ (with default sidebar) | ✅ | ❌ |

**Permission Checks:**

1. **Duplication Permission:** Enforced in `duplicate_page()` line 386-389
   - Non-managers cannot create public duplicates
   - System Manager check for default sidebar copy (line 475)

2. **Sidebar Access:** Uses `ignore_permissions=True` for copying
   - Copying happens server-side, user permissions validated via duplication permission
   - New sidebar belongs to current user or system

### Error Handling

**Location:** Lines 515-520

```python
except Exception as e:
    frappe.log_error(
        title="Sidebar Copy Error during Workspace Duplication",
        message=f"Failed to copy sidebar from {source_workspace_name} to {target_workspace_name}: {str(e)}"
    )
```

**Behavior:**
- Sidebar copy failures are logged but don't prevent workspace duplication
- Workspace is created successfully
- User gets functional workspace with fallback to built-in links
- Error logged for debugging

### Testing Checklist

Test Cases for Sidebar Duplication:

**Public → Private:**
- [ ] Sidebar copied to duplicated private workspace
- [ ] Default links appear in duplicated workspace
- [ ] User can customize duplicated workspace sidebar
- [ ] Hidden links preserved if any

**Private → Private (Same User):**
- [ ] User custom sidebar copied exactly
- [ ] All custom links appear in order
- [ ] Hidden link preferences preserved
- [ ] Duplicated workspace is fully editable

**Public → Public (System Manager):**
- [ ] Admin default sidebar copied
- [ ] Default Workspace Sidebar document created
- [ ] All default links appear

**Public → Public (Non-Manager):**
- [ ] Built-in workspace links appear
- [ ] No admin default sidebar created
- [ ] No errors in logs

**No Sidebar Config:**
- [ ] Duplication succeeds
- [ ] Built-in workspace links appear
- [ ] No sidebar documents created unnecessarily

### Known Limitations

1. **Permission Filtering:** Links are not filtered during copy
   - Filtering happens at display time in `get_user_sidebar_links()`
   - If user loses permission to a link, it won't display (but document exists)

2. **Bulk Operations:** Sidebar copy not optimized for bulk duplication
   - Each duplication creates separate sidebar document
   - Consider optimization for future versions

3. **Module Restrictions:** New workspace might have different modules than source
   - Links might become inaccessible
   - Rely on permission filtering (already implemented)

### Integration with Other Features

**Related Functions:**
- `frappe.copy_doc()` - Copies workspace document and built-in links
- `get_user_sidebar_links()` - Three-tier priority display logic (matches copy priority)
- `save_user_sidebar()` - Saves user customizations after duplication
- `has_permission_for_link_dict()` - Permission filtering on display

**Related DocTypes:**
- `Workspace` - Main workspace document
- `Workspace User Sidebar` - User-specific sidebar customizations
- `Default Workspace Sidebar` - Admin-configured defaults
- `Workspace User Sidebar Link` - Individual sidebar link records

---

**End of Document - Last Updated: 2025-11-14**
