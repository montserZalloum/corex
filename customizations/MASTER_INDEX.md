# Frappe Customization Master Index

**Last Updated:** 2025-11-13
**Total Customizations:** 15 major modifications
**System:** Aurevia Bench - Frappe Framework
**Location:** `/home/corex/aurevia-bench/customizations/`

---

## 📊 Overview Dashboard

### Customization Statistics

| Category | Count |
|----------|-------|
| **New DocTypes** | 3 |
| **Python Backend Files Modified** | 4 |
| **JavaScript Frontend Files Modified** | 3 |
| **SCSS Stylesheet Files Modified** | 3 |
| **Documentation Files Created** | 2 |
| **Configuration Files Updated** | 2 |
| **Total Features Added** | 15+ |

### Modification Summary by Type

```
Backend (Python)        ████████░░ 4 files
Frontend (JavaScript)   ███░░░░░░░ 3 files
Styling (SCSS)          ███░░░░░░░ 3 files
DocTypes                ██░░░░░░░░ 3 new
Docs/Config             ████░░░░░░ 4 files
──────────────────────────────────────
Total Impact            17 files modified/created
```

---

## 🗂️ Customization Catalog

### 1️⃣ WORKSPACE USER SIDEBAR SYSTEM

**Feature:** Allow users to customize their workspace sidebar links per workspace

**Files:**
- **DocType Definition:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace_user_sidebar/`
  - `workspace_user_sidebar.py` - Validation logic
  - `workspace_user_sidebar.json` - DocType metadata

- **Child DocType:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace_user_sidebar_link/`
  - `workspace_user_sidebar_link.json` - Child table definition

**DocType Fields:**
- `workspace` (Link) - Which workspace
- `user` (Link) - Which user owns this customization
- `links` (Table) - Custom links with order
  - Child fields: `link_type`, `link_to`, `label`, `icon`, `idx`
- `is_customized` (Check) - Flag for existence

**Functionality:**
- ✅ Users can customize their workspace sidebars
- ✅ Permission validated (only owner or manager)
- ✅ Supports drag-drop reordering
- ✅ Different sidebar per workspace per user

**Status:** Active - Used by workspace window system

**Related Documentation:**
- See: `WORKSPACE_CUSTOMIZATION_REFERENCE.md` (Created this chat)

---

### 2️⃣ DEFAULT WORKSPACE SIDEBAR SYSTEM

**Feature:** Admin-configurable default sidebar links for public workspaces

**Files:**
- **DocType Definition:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/default_workspace_sidebar/`
  - `default_workspace_sidebar.py` - Validation logic
  - `default_workspace_sidebar.json` - DocType metadata

**DocType Fields:**
- `workspace` (Link) - Which public workspace
- `links` (Table) - Default links for all users
- `created_by` (Link) - Admin who configured it

**Functionality:**
- ✅ System Manager can configure default sidebars
- ✅ Only for public workspaces
- ✅ Overridable by user customization
- ✅ Fallback for workspaces without custom sidebar

**Restrictions:**
- ❌ Cannot be created for private workspaces
- ❌ Non-admins cannot modify

**Status:** Active - Used as fallback in 3-tier sidebar selection

**Related Code:** `desktop.py` - `get_user_sidebar_links()` method (Line 757)

---

### 3️⃣ WORKSPACE FLOATING WINDOW SYSTEM

**Feature:** macOS/Windows 11 style floating windows for opening workspaces

**Files:**
- **Frontend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/views/workspace/workspace.js`
  - 50+ KB file
  - ~300+ lines of window management code
  - Last Modified: 2025-11-13

- **Styling:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/scss/desk/workspace_windows.scss`
  - 12 KB new stylesheet
  - Glass morphism effects
  - Premium UI styling

**Core Methods:**
- `open_workspace_window()` - Create new floating window (Line 1611)
- `make_window_draggable()` - Enable drag functionality
- `setup_window_routing()` - Hook into Frappe router
- `show_page_in_window()` - Display pages in window context
- `toggle_window_edit_mode()` - Enter/exit edit mode
- `make_window_blocks_sortable()` - Enable block reordering
- `initialize_window_editor()` - Setup EditorJS per window

**Features:**
- ✅ Multiple floating windows
- ✅ Z-index management for stacking
- ✅ Draggable titlebar
- ✅ Minimize/Maximize/Close buttons
- ✅ Resizable edges
- ✅ Premium glass morphism styling
- ✅ Per-window route history
- ✅ Per-window editor instances

**Styling Details:**
- Blue-purple gradient titlebar
- Frosted glass effects
- Responsive shadows
- Mobile-friendly (hidden on small screens)

**Status:** Active - Core feature for workspace UI

**Related Documentation:**
- See: `workspace_windows_system.md` (209 lines)
- See: `VISUAL_DIAGRAMS.md` (Window flow diagrams)

---

### 4️⃣ GLOBAL DEEP LINK HANDLER

**Feature:** Preserve deep link context when page is refreshed within workspace

**Files:**
- **Frontend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/views/workspace/workspace.js`
  - Lines 4-106
  - `frappe.workspace_deep_link` global object

**Core Methods:**
- `init()` - Initialize on document ready
- `setup_router_hooks()` - Wrap frappe router
- `handle_deep_link_on_route_change()` - Process deep links

**Functionality:**
- ✅ Detects deep links on page refresh (e.g., `/app/Form/User/user-001`)
- ✅ Stores pending deep link if workspace not loaded
- ✅ Handles after workspace initialization
- ✅ Works for: Form, List, Report, Tree, Kanban, Calendar, Gantt, Dashboard, etc.

**How It Works:**
1. User refreshes page on deep link
2. Workspace not loaded yet
3. Stores route in `pending_deep_link`
4. Navigates to workspace to initialize system
5. Workspace detects pending deep link
6. Opens deep link in workspace context

**Status:** Active - Essential for deep link support

**Related Documentation:**
- See: `routes_handling_inside_window.md` (250 lines)

---

### 5️⃣ PER-WINDOW ROUTE HISTORY

**Feature:** Back button for each floating window with independent navigation

**Files:**
- **Frontend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/views/workspace/workspace.js`
  - Route history stack per window
  - Back button implementation

**Core Methods:**
- `push_route_to_stack()` - Add route to window history
- `pop_route_from_stack()` - Get previous route
- `show_back_button()` - Display back button
- `handle_back_click()` - Navigate back

**Features:**
- ✅ Each window has independent route history
- ✅ Back button shows only when history exists
- ✅ Breadcrumb trail visualization
- ✅ Prevents loss of context

**Data Structure:**
```javascript
$window.data("route-stack", [
    {route: ["List", "User"], breadcrumb: "User"},
    {route: ["Form", "User", "user-001"], breadcrumb: "user-001"},
    // ... current route
])
```

**Status:** Active - Core navigation feature

**Related Documentation:**
- See: `routes_handling_inside_window.md` - Complete route handling guide

---

### 6️⃣ WORKSPACE PERMISSIONS CUSTOMIZATION

**Feature:** Allow users to edit their own private workspaces without Workspace Manager role

**Files:**
- **Frontend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/views/workspace/workspace.js`
  - Line 189 - Permission check
  - Line 1633 - Edit button visibility
  - Line 1848 - Save with title param
  - Lines 3063-3077 - Sidebar edit mode conditional
  - Lines 3123-3131 - Sidebar save conditional
  - Lines 2196, 2199 - Draggable class conditional
  - Line 2283 - Sortable skip for public

**Backend:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace/workspace.py`
- Already had permission checks (not modified)
- Used existing checks for validation

**Permission Rules:**
- Private workspace owner: ✅ Edit content & sidebar
- Private workspace non-owner: ❌ No access
- Public workspace manager: ✅ Edit content only
- Public workspace non-manager: ❌ No access

**Status:** Created in this chat session (2025-11-13)

**Related Documentation:**
- See: `WORKSPACE_CUSTOMIZATION_REFERENCE.md` (Complete guide)
- See: `QUICK_REFERENCE.md` (Quick lookup)
- See: `VISUAL_DIAGRAMS.md` (Flow diagrams)

---

### 7️⃣ SIDEBAR LINK PERMISSION VALIDATION

**Feature:** Validate all sidebar links against user permissions before display/save

**Files:**
- **Backend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/desktop.py`
  - Lines 1173-1243
  - `has_permission_for_sidebar_link()` - Line 1184
  - `has_permission_for_link_dict()` - Line 1189
  - `_check_link_permission()` - Line 1194

**Permission Matrix:**
| Link Type | Check Method | Details |
|-----------|--------------|---------|
| DocType | `frappe.has_permission()` | Read permission on DocType |
| Page | Role check | User must have role if page restricted |
| Report | `ref_doctype` permission | Read permission on reference DocType |
| Custom HTML Block | `frappe.has_permission()` | Read permission on block |
| Number Card | `frappe.has_permission()` | Read permission on card |
| Dashboard Chart | `frappe.has_permission()` | Read permission on chart |
| URL | Always allowed | Direct URLs have no permission |

**Core Module Handling:**
- Special case: "Core" module skips Module Def check
- Maintains role-based security
- Prevents permission loops on system modules

**Status:** Active - Critical for security

**Related Code:**
- Function `_check_link_permission()` (desktop.py:1194)
- Used by: `get_user_sidebar_links()`, `save_user_sidebar()`

---

### 8️⃣ WORKSPACE ACCESSIBILITY CHECKS

**Feature:** Determine if user can access a specific workspace

**Files:**
- **Backend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/desktop.py`
  - Lines 1155-1172
  - `can_access_workspace()` - Comprehensive permission logic

**Access Rules:**
```
Public workspaces with module:
├─ User has module access? → YES: Allow
└─ NO: Check domain restriction
        ├─ Domain restricted? → NO: Allow
        └─ User in domain? → YES: Allow, NO: Deny

Private workspaces:
├─ User is owner? → YES: Allow
└─ User is manager? → YES: Allow, NO: Deny

Workspaces without module:
└─ Check domain restrictions only
```

**Features:**
- ✅ Module-based access control
- ✅ Domain restriction support
- ✅ Private workspace ownership check
- ✅ Workspace Manager override

**Status:** Active - Essential for workspace filtering

**Related Code:** Used in `get_workspace_sidebar_items()`

---

### 9️⃣ THREE-TIER SIDEBAR SELECTION

**Feature:** Priority-based sidebar link selection (custom > default > workspace)

**Files:**
- **Backend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/desktop.py`
  - Lines 757-852
  - `get_user_sidebar_links()` method

**Selection Priority:**
```
For a workspace, return links in this order:

TIER 1: User Customization
├─ Check: Does Workspace User Sidebar exist?
├─ Check: Does user have permission?
└─ Return: Custom links if exists

TIER 2: Admin Default Configuration
├─ Check: Does Default Workspace Sidebar exist?
└─ Return: Admin-configured links if exists

TIER 3: Workspace Definition
├─ Check: Workspace.links table
└─ Return: Default links from workspace
```

**Backend Response:**
```python
{
    "links": [...],              # Filtered links
    "is_customized": bool,       # Is this user customization?
    "default_sidebar": bool,     # Is this admin default?
    "permission_denied_links": []  # Links user can't access
}
```

**Status:** Active - Core sidebar logic

**Related Code:** Function `get_user_sidebar_links()` (desktop.py:757)

---

### 🔟 SIDEBAR CUSTOMIZATION SAVE

**Feature:** Save user's custom sidebar configuration with validation

**Files:**
- **Backend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/desktop.py`
  - Lines 865-916
  - `save_user_sidebar()` method

**Validation Steps:**
1. User has permission to access workspace?
2. For private workspace: User is owner or manager?
3. For public workspace: Denied (can't customize public)
4. All links user is adding: Has permission?
5. Create/update Workspace User Sidebar document

**Features:**
- ✅ Permission validation before save
- ✅ Link permission checking
- ✅ Only for private workspaces
- ✅ Updates ordering
- ✅ Clears cache after save

**Errors Thrown:**
- "You don't have permission to customize this workspace"
- "You don't have permission to add {item} to sidebar"

**Status:** Active - Critical for customization

**Related Code:** Function `save_user_sidebar()` (desktop.py:865)

---

### 1️⃣1️⃣ SIDEBAR RESET FUNCTIONALITY

**Feature:** Remove user customization and revert to defaults

**Files:**
- **Backend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/desktop.py`
  - Lines 927-1001
  - `reset_user_sidebar()` method

**Functionality:**
- ✅ Deletes Workspace User Sidebar document
- ✅ Ignores permissions (already validated)
- ✅ Returns to admin default or workspace links
- ✅ Clears cache

**When Used:**
- User clicks "Reset to Default" button
- Admin removes all customizations
- User requests revert

**Status:** Active - Cleanup functionality

---

### 1️⃣2️⃣ PRIVATE WORKSPACE CREATION

**Feature:** Users can create their own private workspaces

**Files:**
- **Backend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/desktop.py`
  - Lines 1022-1029
  - `create_private_workspace()` method

**Process:**
1. User calls with workspace title and content
2. System sets `for_user = frappe.session.user`
3. System sets `public = 0`
4. Creates Workspace document
5. Saves with `ignore_permissions=True`
6. Clears user's bootinfo cache

**Naming Convention:**
- Format: `{title}-{username}`
- Example: `Dashboard-user@example.com`

**Status:** Active - Core functionality

---

### 1️⃣3️⃣ WORKSPACE CLONING WITH SIDEBAR DUPLICATION

**Feature:** Users can duplicate workspaces with complete sidebar configuration copied automatically

**Files:**
- **Backend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace/workspace.py`
  - `duplicate_page()` method (line 380-414)
  - `copy_sidebar_on_duplicate()` function (line 417-520)

**What Gets Copied:**
- ✅ Workspace content (EditorJS blocks)
- ✅ Built-in workspace links
- ✅ User custom sidebar (if exists)
- ✅ Admin default sidebar (if exists)
- ✅ Hidden link preferences
- ✅ All metadata (icon, color, parent, etc.)

**Three-Tier Sidebar Priority System:**

When duplicating a workspace, the system automatically copies the sidebar using this priority:

1. **TIER 1 - User Custom Sidebar** (Highest Priority)
   - If user has customized the sidebar on source workspace
   - Copies all custom links and hidden link preferences
   - Preserves exact link order and customizations

2. **TIER 2 - Admin Default Sidebar**
   - If admin configured a default sidebar for the workspace
   - Converts to user customization when duplicating to private
   - Copies as-is when duplicating to public (System Manager only)

3. **TIER 3 - Built-in Workspace Links** (Fallback)
   - Already copied by `frappe.copy_doc()`
   - Used if no custom or default sidebar exists

**Duplication Scenarios:**

| Scenario | Source Sidebar | Result | Condition |
|---|---|---|---|
| Public → Private | User Custom | Copied to new private workspace | Always |
| Public → Private | Admin Default | Converted to user custom sidebar | Always |
| Public → Private | None | Uses built-in workspace links | Always |
| Private → Private | User Custom | Copied to new private workspace | Same user |
| Private → Private | None | Uses built-in workspace links | Same user |
| Public → Public | Admin Default | Copied to new public workspace | System Manager only |
| Public → Public | User Custom | Copied to new public workspace | System Manager only |
| Public → Public | None | Uses built-in workspace links | Any user with permission |

**Restrictions:**
- ❌ Cannot clone other users' private workspaces
- ✅ Can clone public workspaces (sidebar copied)
- ✅ Can clone own private workspaces (sidebar copied)
- ✅ System Managers can clone public → public with admin default sidebar
- ⚠️ Non-System Managers duplicating public → public get built-in links (no admin default)

**Error Handling:**
- Sidebar copy failures are logged but don't prevent workspace duplication
- Workspace is created successfully even if sidebar copy fails

**Status:** Active - Full implementation with smart three-tier sidebar copying

---

### 1️⃣4️⃣ AWESOME BAR WORKSPACE INTEGRATION

**Feature:** Workspace-aware search suggestions in awesome bar

**Files:**
- **Frontend Logic:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/ui/toolbar/awesome_bar.js`
  - 10+ KB file
  - 151+ lines added
  - Last Modified: 2025-11-09

**Enhancements:**
- ✅ Search results filtered by current workspace context
- ✅ Workspace shortcuts in awesome bar
- ✅ Recent workspaces suggestions
- ✅ Private workspace awareness

**Features:**
- Autocomplete aware of open windows
- Suggests items relevant to current workspace
- Shows workspace-specific shortcuts

**Status:** Active - Search UX enhancement

---

### 1️⃣5️⃣ WORKSPACE SCSS STYLING SYSTEM

**Feature:** Premium styling for workspace UI components

**Files:**
- **Main Stylesheet:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/scss/desk/workspace_windows.scss`
  - 12 KB new stylesheet
  - Glass morphism effects
  - Premium gradients

- **Related Updates:**
  - `desktop.scss` - Integration
  - `index.scss` - Import addition

**Styling Components:**
```
workspace-windows.scss:
├── Variables (colors, fonts)
├── Desktop background
├── Floating windows
│   ├── Titlebar (blue-purple gradient)
│   ├── Window controls (buttons)
│   ├── Content area
│   ├── Resize handles
│   └── Shadow effects
├── Glass morphism effects
├── Responsive breakpoints
└── Print styles
```

**Features:**
- ✅ macOS Monterey glass morphism
- ✅ Windows 11 design language
- ✅ Responsive for all screen sizes
- ✅ Accessibility considerations
- ✅ Dark mode support

**Status:** Active - UI Framework

---

## 🎯 Feature Integration Map

```
WORKSPACE SYSTEM ARCHITECTURE:

┌─────────────────────────────────────────────────────────┐
│                  USER INTERFACE LAYER                   │
├─────────────────────────────────────────────────────────┤
│  workspace.js                                            │
│  ├─ Floating Windows (Feature #3)                       │
│  ├─ Route History (Feature #5)                          │
│  ├─ Deep Link Handling (Feature #4)                     │
│  ├─ Permission UI (Feature #6)                          │
│  └─ Awesome Bar Integration (Feature #14)               │
│                                                          │
│  workspace_windows.scss + desktop.scss                  │
│  └─ Styling System (Feature #15)                        │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│               BACKEND LOGIC LAYER                       │
├─────────────────────────────────────────────────────────┤
│  desktop.py                                              │
│  ├─ Accessibility Checks (Feature #8)                   │
│  ├─ Three-Tier Sidebar (Feature #9)                     │
│  ├─ Save Customization (Feature #10)                    │
│  ├─ Reset Sidebar (Feature #11)                         │
│  ├─ Create Private Workspace (Feature #12)              │
│  ├─ Clone to Private (Feature #13)                      │
│  ├─ Link Permissions (Feature #7)                       │
│  └─ [Cache Management & Validation]                     │
│                                                          │
│  workspace.py                                            │
│  └─ Workspace Document Logic                            │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│                  DATA LAYER (DOCTYPES)                  │
├─────────────────────────────────────────────────────────┤
│  Workspace (Core)                                        │
│  ├─ Workspace User Sidebar (Feature #1)                 │
│  │  └─ Workspace User Sidebar Link (Child)              │
│  │                                                       │
│  └─ Default Workspace Sidebar (Feature #2)              │
└─────────────────────────────────────────────────────────┘
```

---

## 🔗 Documentation Reference Guide

### By Feature

| # | Feature | Quick Ref | Full Doc | Diagrams |
|---|---------|-----------|----------|----------|
| 1 | User Sidebar | N/A | workspace.py | VISUAL_DIAGRAMS.md |
| 2 | Default Sidebar | N/A | workspace.py | VISUAL_DIAGRAMS.md |
| 3 | Floating Windows | N/A | workspace_windows_system.md | VISUAL_DIAGRAMS.md |
| 4 | Deep Links | N/A | routes_handling_inside_window.md | VISUAL_DIAGRAMS.md |
| 5 | Route History | QUICK_REFERENCE.md | routes_handling_inside_window.md | VISUAL_DIAGRAMS.md |
| 6 | Permissions | QUICK_REFERENCE.md | WORKSPACE_CUSTOMIZATION_REFERENCE.md | VISUAL_DIAGRAMS.md |
| 7 | Link Validation | N/A | WORKSPACE_CUSTOMIZATION_REFERENCE.md | N/A |
| 8 | Accessibility | N/A | WORKSPACE_CUSTOMIZATION_REFERENCE.md | N/A |
| 9 | Three-Tier | N/A | (In desktop.py comments) | N/A |
| 10 | Save Custom | QUICK_REFERENCE.md | WORKSPACE_CUSTOMIZATION_REFERENCE.md | VISUAL_DIAGRAMS.md |
| 11 | Reset Sidebar | N/A | (In desktop.py) | N/A |
| 12 | Create Private | N/A | WORKSPACE_CUSTOMIZATION_REFERENCE.md | N/A |
| 13 | Clone to Private | N/A | (In desktop.py) | N/A |
| 14 | Awesome Bar | N/A | (In awesome_bar.js) | N/A |
| 15 | SCSS System | N/A | workspace_windows_system.md | N/A |

### By File

| File | Features | Documentation |
|------|----------|---|
| workspace.js | #3, #4, #5, #6 | workspace_windows_system.md, routes_handling_inside_window.md, WORKSPACE_CUSTOMIZATION_REFERENCE.md |
| desktop.py | #1, #2, #7, #8, #9, #10, #11, #12, #13 | WORKSPACE_CUSTOMIZATION_REFERENCE.md |
| awesome_bar.js | #14 | (Inline code comments) |
| workspace_windows.scss | #15 | workspace_windows_system.md |
| workspace.py | (Core logic) | WORKSPACE_CUSTOMIZATION_REFERENCE.md |

---

## 🚀 Common Development Tasks

### Task: Modify Workspace Permissions
- Files: workspace.js (Line 189), workspace.py (update_page)
- See: WORKSPACE_CUSTOMIZATION_REFERENCE.md
- Test: QUICK_REFERENCE.md testing checklist

### Task: Add Sidebar Link Type
- Files: desktop.py (_check_link_permission), workspace.js (render_sidebar)
- See: WORKSPACE_CUSTOMIZATION_REFERENCE.md (Link Validation section)

### Task: Customize Floating Window
- Files: workspace.js (open_workspace_window), workspace_windows.scss
- See: workspace_windows_system.md

### Task: Change Sidebar Selection Priority
- Files: desktop.py (get_user_sidebar_links)
- See: WORKSPACE_CUSTOMIZATION_REFERENCE.md (Three-Tier Sidebar section)

### Task: Add New Route Handling
- Files: workspace.js (setup_window_routing), workspace.py
- See: routes_handling_inside_window.md

---

## 📋 Maintenance Schedule

### Code Review Points

- [ ] **Monthly:** Review permission checks in `_check_link_permission()`
- [ ] **Per Release:** Test sidebar customization save/reset
- [ ] **Per Release:** Verify deep link handling for new DocTypes
- [ ] **Quarterly:** Audit Workspace User Sidebar for orphaned records
- [ ] **Per Feature:** Test floating window dragging on new screens

### Testing Checklist

- [ ] Private workspace owner can edit content & sidebar
- [ ] Private workspace non-owner cannot access
- [ ] Public workspace shows content-only mode for non-managers
- [ ] Sidebar links filtered by permissions
- [ ] Deep links work after page refresh
- [ ] Back button works with route history
- [ ] Floating windows stack correctly
- [ ] Responsive design on mobile devices

---

## 🔐 Security Considerations

### Critical Security Points

1. **Backend Permission Enforcement**
   - All modifications validated on backend
   - Frontend validation is UI-only, never trusted
   - File: desktop.py, workspace.py

2. **Sidebar Link Validation**
   - Every link checked against user permissions
   - Special handling for Core module
   - File: desktop.py (_check_link_permission)

3. **User Ownership Check**
   - Private workspace owner verified from `for_user` field
   - Cannot edit other users' workspaces
   - File: desktop.py (update_page, save_user_sidebar)

4. **Module Access Control**
   - Domain restrictions enforced
   - Module-based access validated
   - File: desktop.py (can_access_workspace)

### Security Audit Checklist

- [ ] User cannot modify other users' private workspaces
- [ ] User cannot save links they don't have access to
- [ ] Non-managers cannot customize public workspace sidebars
- [ ] Permission checks on both frontend AND backend
- [ ] Core module link access doesn't bypass role checks
- [ ] Domain-restricted workspaces properly filtered

---

## 📈 Performance Optimization Notes

### Caching Strategy

```
Cache Points:
├── Workspace sidebar links (cached per workspace)
├── User bootinfo (cleared on workspace change)
├── Workspace accessibility (computed on demand)
└── Default workspace sidebar (admin-configurable)
```

### Load Testing Recommendations

- Test with 1000+ workspaces
- Test with 500+ floating windows open
- Test sidebar with 200+ custom links
- Monitor deep link performance on page refresh

---

## 🎓 Learning Path for New Developers

### Level 1: Understanding Basics (1-2 hours)
1. Read: QUICK_REFERENCE.md
2. Read: VISUAL_DIAGRAMS.md
3. Understand: Permission matrix

### Level 2: Deep Dive (3-4 hours)
1. Read: WORKSPACE_CUSTOMIZATION_REFERENCE.md
2. Read: workspace_windows_system.md
3. Review: Code in workspace.js (functions #3, #4, #5, #6)

### Level 3: Advanced Implementation (5+ hours)
1. Study: desktop.py (full file)
2. Study: workspace.py (full file)
3. Study: awesome_bar.js integration
4. Implement: New feature or modification

### Level 4: Expert Mastery (10+ hours)
1. Understand: Full architecture
2. Implement: Complex features
3. Optimize: Performance
4. Mentor: Other developers

---

## 📞 Support & Escalation

### When Documentation is Unclear
1. Check VISUAL_DIAGRAMS.md for flows
2. Review inline code comments
3. Search other files in this directory
4. Check Frappe documentation links

### Common Questions

**Q: Where do I modify workspace permissions?**
A: workspace.js line 189, see WORKSPACE_CUSTOMIZATION_REFERENCE.md

**Q: How do I add a new sidebar link type?**
A: Modify _check_link_permission() in desktop.py, see section 7 above

**Q: Where is the floating window logic?**
A: workspace.js, see workspace_windows_system.md

**Q: How does sidebar selection work?**
A: Three-tier priority (Feature #9), see section 9 above

---

## 🔍 Quick Code Lookup

**Need to find something?** Use these shortcuts:

| Looking For | File | Lines | See Also |
|-------------|------|-------|----------|
| Edit permissions | workspace.js | 189 | WORKSPACE_CUSTOMIZATION_REFERENCE.md |
| Sidebar selection | desktop.py | 757 | Feature #9 above |
| Floating windows | workspace.js | 1611 | workspace_windows_system.md |
| Deep links | workspace.js | 4-106 | routes_handling_inside_window.md |
| Route history | workspace.js | ~2600+ | routes_handling_inside_window.md |
| Link validation | desktop.py | 1194 | Feature #7 above |
| Workspace access | desktop.py | 1155 | Feature #8 above |
| Save customization | desktop.py | 865 | Feature #10 above |
| Create private | desktop.py | 1022 | Feature #12 above |

---

## 📚 Complete Documentation Index

```
/home/corex/aurevia-bench/customizations/

├── MASTER_INDEX.md                          ← YOU ARE HERE
│   └── Complete overview of all customizations
│
├── WORKSPACE_CUSTOMIZATION_REFERENCE.md     ← Feature #6 Deep Dive
│   └── Permission system documentation
│
├── QUICK_REFERENCE.md                       ← Quick Lookup
│   └── Fast reference for common tasks
│
├── VISUAL_DIAGRAMS.md                       ← Diagrams & Flows
│   └── Visual representation of systems
│
└── [Feature-specific docs in main repo]
    ├── workspace_windows_system.md          ← Features #3, #15
    ├── routes_handling_inside_window.md     ← Features #4, #5
    └── [Inline code comments]               ← Features #1, #2, #7-14

Reference Docs (Not in customizations/):
├── /apps/frappe/frappe_docs/workspace_windows_system.md
└── /apps/frappe/frappe_docs/routes_handling_inside_window.md
```

---

## ✅ Verification Checklist

- [ ] Read MASTER_INDEX.md (this file) - 5-10 min
- [ ] Understand all 15 features - 20-30 min
- [ ] Know which file implements each feature - 10 min
- [ ] Can locate documentation for each feature - 5 min
- [ ] Can answer: "Where do I modify X?" - 10 min
- [ ] Can run tests from QUICK_REFERENCE.md - 15 min

**Total Time to Master:** ~1-2 hours

---

**Last Updated:** 2025-11-13
**Maintained By:** Development Team
**Next Review:** 2025-12-13 or when major changes made

---

**🎯 This Master Index is your guide to the entire Frappe workspace customization system. Start here, then dive into specific documentation as needed.**

**Questions? Check the feature number in the table above, then reference the specific documentation section.**
