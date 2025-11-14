# Workspace Customization - Visual Diagrams & Flows

## 1. Permission Decision Tree

```
User wants to edit workspace
        ↓
Is workspace PUBLIC?
    ├─ YES → Is user WORKSPACE MANAGER?
    │         ├─ YES → ✅ CAN EDIT CONTENT (sidebar edit: DISABLED)
    │         └─ NO  → ❌ CANNOT EDIT (button hidden)
    │
    └─ NO → Is user the WORKSPACE OWNER?
             ├─ YES → ✅ CAN EDIT CONTENT & SIDEBAR
             └─ NO  → Is user WORKSPACE MANAGER?
                      ├─ YES → ✅ CAN EDIT CONTENT & SIDEBAR
                      └─ NO  → ❌ CANNOT EDIT
```

---

## 2. Workspace Types & Ownership

```
WORKSPACE DOCUMENT STRUCTURE:

┌─────────────────────────────────────┐
│         Workspace Document          │
├─────────────────────────────────────┤
│ name:       "Dashboard-user@ex.com" │
│ title:      "Dashboard"             │
│ public:     0 (false)               │
│ for_user:   "user@example.com"      │ ← KEY: Owner
│ content:    {...EditorJS...}        │
│ label:      "Dashboard-user@ex.com" │
│ icon:       "dashboard"             │
│ parent_page: ""                     │
└─────────────────────────────────────┘

                ↓ vs ↓

┌─────────────────────────────────────┐
│         Workspace Document          │
├─────────────────────────────────────┤
│ name:       "Company Dashboard"     │
│ title:      "Company Dashboard"     │
│ public:     1 (true)                │
│ for_user:   "" (empty - no owner)   │ ← KEY: Public
│ content:    {...EditorJS...}        │
│ label:      "Company Dashboard"     │
│ icon:       "building"              │
│ links:      [Link1, Link2, ...]     │
└─────────────────────────────────────┘
```

---

## 3. Sidebar Customization Storage

```
PRIVATE WORKSPACE SIDEBAR:

Workspace "Dashboard-user@ex.com"
    ↓
Check if user customized sidebar
    ↓
Workspace User Sidebar document exists?
    ├─ YES → Load custom links
    │         └─ User can drag-drop, reorder
    │
    └─ NO → Load default from Workspace.links
             └─ User can drag-drop, reorder
                 (first drag creates custom sidebar)

                    ↓ vs ↓

PUBLIC WORKSPACE SIDEBAR:

Workspace "Company Dashboard"
    ↓
Load default from Workspace.links
    ↓
NO custom sidebar allowed
    ├─ NO drag-drop
    ├─ NO reordering
    └─ NO customization saved
```

---

## 4. Edit Mode Flow - Private Workspace Owner

```
┌─────────────────────────────────────────────────────────┐
│         USER OPENS PRIVATE WORKSPACE                    │
└─────────────────────────────────────────────────────────┘
                           ↓
                    setup_pages()
                           ↓
        is_editable = (true && user owns it) || false
                           ↓
                  is_editable = TRUE
                           ↓
         ┌──────────────────────────────────┐
         │   Edit button VISIBLE (✎)        │
         │   Sidebar links DRAGGABLE         │
         │   Drag handles VISIBLE           │
         └──────────────────────────────────┘
                           ↓
            USER CLICKS EDIT BUTTON
                           ↓
         toggle_window_edit_mode()
                           ↓
         Is workspace PUBLIC?
         ├─ NO (private) → enter_sidebar_edit_mode()
         │                       ↓
         │         Sidebar shows EDIT CONTROLS:
         │         ├─ [+] Add Link
         │         ├─ [💾] Save
         │         ├─ [🔄] Reset
         │         └─ [✕] Cancel
         │
         │                       ↓
         │   USER MODIFIES CONTENT & SIDEBAR
         │                       ↓
         │           USER CLICKS SAVE (💾)
         │                       ↓
         │    save_both_workspace_and_sidebar()
         │                       ↓
         │        ┌──────────┬──────────┐
         │        ↓          ↓
         │   Backend:    Backend:
         │   save_page() save_user_sidebar()
         │        ↓          ↓
         │   Content    Sidebar Links
         │   SAVED      SAVED
         │        └──────────┬──────────┘
         │                    ↓
         │          ✅ Success Message
         │
         └─ YES (public) → Skip sidebar edit
                                  ↓
                    Show "Content only" message
                                  ↓
              USER MODIFIES CONTENT ONLY
                                  ↓
                          USER CLICKS SAVE
                                  ↓
                    save_window_workspace()
                                  ↓
                            Backend:
                            save_page()
                                  ↓
                            Content SAVED
                            Sidebar IGNORED
                                  ↓
                          ✅ Success Message
```

---

## 5. Edit Mode Flow - Public Workspace Non-Manager

```
┌─────────────────────────────────────────────────────────┐
│         USER OPENS PUBLIC WORKSPACE                     │
└─────────────────────────────────────────────────────────┘
                           ↓
                    setup_pages()
                           ↓
    is_editable = (false) || false = FALSE
                           ↓
  ┌──────────────────────────────────────────┐
  │  Edit button HIDDEN (display: none)      │
  │  Sidebar links NOT draggable             │
  │  Drag handles NOT rendered               │
  │  User CANNOT enter edit mode             │
  └──────────────────────────────────────────┘
                           ↓
         USER CAN ONLY VIEW (read-only)
                           ↓
     ┌────────────────────────────────────┐
     │  • View workspace content          │
     │  • Click sidebar links to navigate │
     │  • Cannot modify anything          │
     └────────────────────────────────────┘
```

---

## 6. Sidebar Rendering - Comparison

```
PRIVATE WORKSPACE SIDEBAR RENDERING:

render_sidebar() {
    const is_draggable_class = !page.public ? 'is-draggable' : '';
    //                           ↓
    //                        TRUE

    links.forEach(link => {
        <div class="sidebar-link is-draggable">
                                     ↑
                         User CAN drag-drop

        <div class="drag-handle">🔷</div>  ← VISIBLE
        <svg class="icon">...</svg>
        <span>Link Label</span>
        </div>
    });

    setup_sidebar_sortable() {
        if (page.public || !container) return;
        //              ↑
        //            FALSE

        // Initialize Sortable.js
        new Sortable(container, { ... });  ← ENABLED
    }
}

                        ↓ vs ↓

PUBLIC WORKSPACE SIDEBAR RENDERING:

render_sidebar() {
    const is_draggable_class = !page.public ? 'is-draggable' : '';
    //                           ↓
    //                        FALSE → '' (empty)

    links.forEach(link => {
        <div class="sidebar-link">
                                   ↑
                    User CANNOT drag-drop

        <div class="drag-handle">🔷</div>  ← HIDDEN (in CSS)
        <svg class="icon">...</svg>
        <span>Link Label</span>
        </div>
    });

    setup_sidebar_sortable() {
        if (page.public || !container) return;
        //  ↑
        //  TRUE

        // Skip initialization
        return;  ← DISABLED
    }
}
```

---

## 7. Data Save Flow

```
USER CLICKS SAVE BUTTON
        ↓
save_both_workspace_and_sidebar()
        ├─ FIRST: save_window_workspace()
        │   ├─ Collect blocks from editor
        │   ├─ Call frappe.call({
        │   │   method: "save_page",
        │   │   args: {
        │   │       title: page.title,      ← NOT page.name!
        │   │       public: page.public,
        │   │       blocks: JSON.stringify(blocks)
        │   │   }
        │   │ })
        │   ├─ Backend: save_page()
        │   │   ├─ Find workspace by title + for_user
        │   │   ├─ Update content field
        │   │   ├─ Save to database
        │   │   └─ Clear cache
        │   └─ Exit editor edit mode
        │
        └─ SECOND: Check if should save sidebar
            if (!page.public) {  ← KEY CHECK
                save_sidebar_customizations()
                ├─ Collect links from DOM
                ├─ Call frappe.call({
                │   method: "save_user_sidebar",
                │   args: { links: [...] }
                │ })
                ├─ Backend: save_user_sidebar()
                │   ├─ Check permissions
                │   ├─ Create/Update Workspace User Sidebar doc
                │   └─ Save to database
                └─ Exit sidebar edit mode
            }
            else {
                // Don't save sidebar for public workspaces
                return;
            }
```

---

## 8. Backend Permission Enforcement

```
Backend Methods Check Permissions:

save_page(title, public, blocks):
    ├─ Find workspace by title + for_user
    ├─ Verify ownership (implicit in query)
    └─ Save content

update_page(name, title, ...):
    ├─ Load workspace document
    ├─ IF not public AND for_user != user AND not manager:
    │   └─ THROW ERROR ❌
    ├─ Else:
    │   └─ Update and save ✅

save_user_sidebar(workspace, links):
    ├─ Check: user owns workspace OR is manager
    ├─ IF not allowed:
    │   └─ THROW ERROR ❌
    ├─ Else:
    │   └─ Create/update Workspace User Sidebar ✅

delete_page(workspace):
    ├─ IF public AND not manager:
    │   └─ THROW ERROR ❌
    ├─ IF not public AND (not owner) AND (not manager):
    │   └─ THROW ERROR ❌
    └─ Else:
        └─ Delete ✅
```

---

## 9. Class/Styling System

```
DRAGGABLE CLASS EFFECTS:

.sidebar-link.is-draggable {
    cursor: move;                    ← Shows move cursor
    border: dashed 1px #ccc;         ← Shows draggable border
    position: relative;
}

.sidebar-link.is-draggable .drag-handle {
    display: flex;                   ← Makes drag handle visible
    cursor: grab;
}

.sidebar-link:not(.is-draggable) {
    cursor: default;                 ← Normal cursor

    .drag-handle {
        display: none;               ← Hides drag handle
    }
}

.sortable-ghost {
    opacity: 0.5;                    ← When dragging
    background: #f0f0f0;
}
```

---

## 10. Permission Matrix

```
                    PRIVATE WORKSPACE          PUBLIC WORKSPACE
                    (for_user = user)          (for_user = '')

OWNER/              ┌──────────────────┐       ┌──────────────────┐
CURRENT USER        │ Edit Button: ✅  │       │ Edit Button: ❌  │
                    │ Edit Content: ✅ │       │ Edit Content: ❌ │
                    │ Edit Sidebar: ✅ │       │ Edit Sidebar: ❌ │
                    │ Drag Links: ✅   │       │ Drag Links: ❌   │
                    │ Save: ✅         │       │ Save: ❌         │
                    └──────────────────┘       └──────────────────┘

OTHER USER          ┌──────────────────┐       ┌──────────────────┐
(Non-Manager)       │ Edit Button: ❌  │       │ Edit Button: ❌  │
                    │ Edit Content: ❌ │       │ Edit Content: ❌ │
                    │ Edit Sidebar: ❌ │       │ Edit Sidebar: ❌ │
                    │ Drag Links: ❌   │       │ Drag Links: ❌   │
                    │ Save: ❌         │       │ Save: ❌         │
                    └──────────────────┘       └──────────────────┘

WORKSPACE           ┌──────────────────┐       ┌──────────────────┐
MANAGER             │ Edit Button: ✅  │       │ Edit Button: ✅  │
                    │ Edit Content: ✅ │       │ Edit Content: ✅ │
                    │ Edit Sidebar: ✅ │       │ Edit Sidebar: ❌ │
                    │ Drag Links: ✅   │       │ Drag Links: ❌   │
                    │ Save: ✅         │       │ Save: ✅ (content)
                    └──────────────────┘       └──────────────────┘
```

---

## 11. Code Execution Order

```
PAGE LOAD:
1. setup_pages() → Determine is_editable
2. open_workspace_window() → Create window HTML with conditional button
3. build_window_sidebar() → Fetch sidebar from backend
4. render_sidebar() → Create DOM with conditional draggable class
5. setup_sidebar_navigation() → Add click handlers for navigation
6. setup_sidebar_sortable() → Initialize drag-drop (if allowed)

USER CLICKS EDIT:
7. toggle_window_edit_mode() → Check if public before sidebar edit
8. enter_sidebar_edit_mode() → Only if NOT public
9. Editor enters edit mode

USER SAVES:
10. save_main_workspace() → Calls save_page() with page.title
11. save_both_workspace_and_sidebar() → Checks if !page.public
12. save_sidebar_customizations() → Only if NOT public
13. Backend saves and clears cache
14. Frontend shows success message and exits edit mode
```

---

## 12. Variable Truth Table

```
For condition: page.is_editable = (!page.public && page.for_user === frappe.session.user) || this.has_access

Public | Owner | Manager | is_editable
────────────────────────────────────
  0    |   1   |    0    |    1      ✅ (private owner)
  0    |   0   |    0    |    0      ❌ (private non-owner)
  0    |   0   |    1    |    1      ✅ (private manager)
  1    |   -   |    0    |    0      ❌ (public non-manager)
  1    |   -   |    1    |    1      ✅ (public manager)
```

---

## 13. Edit Button Visibility Logic

```
style="${page.public && !this.has_access ? 'display: none;' : ''}"

Condition: page.public AND NOT has_access

Public | Manager | Display
────────────────────────────
  0    |    0    | Block displays    ✅
  0    |    1    | Block displays    ✅
  1    |    0    | display: none     ❌
  1    |    1    | Block displays    ✅

Result: Button hidden only when (public=true AND manager=false)
```

---

## 14. Sidebar Edit Condition

```
if (!page.public) {
    this.enter_sidebar_edit_mode($window, page);
}

Public | Execute
────────────────
  0    | YES    ✅ (private - edit sidebar)
  1    | NO     ❌ (public - don't edit sidebar)
```

---

## 15. Sidebar Save Condition

```
if (!page.public) {
    this.save_sidebar_customizations($window, page);
}

Public | Execute
────────────────
  0    | YES    ✅ (private - save sidebar)
  1    | NO     ❌ (public - don't save sidebar)
```

---

## 16. File Organization Diagram

```
/home/corex/aurevia-bench/
│
├── apps/frappe/frappe/
│   │
│   ├── public/js/frappe/views/workspace/
│   │   └── workspace.js ◄─── FRONTEND (Modified)
│   │       ├── setup_pages()                     Line 179
│   │       ├── open_workspace_window()           Line 1611
│   │       ├── save_main_workspace()             Line 1821
│   │       ├── toggle_window_edit_mode()         Line 3027
│   │       ├── save_both_workspace_and_sidebar() Line 3118
│   │       ├── render_sidebar()                  Line 2146
│   │       └── setup_sidebar_sortable()          Line 2278
│   │
│   ├── desk/
│   │   ├── desktop.py ◄───────── BACKEND (Reference)
│   │   │   ├── get_workspace_sidebar_items()    Line 488
│   │   │   ├── get_user_sidebar_links()         Line 757
│   │   │   └── save_user_sidebar()              Line 865
│   │   │
│   │   └── doctype/workspace/
│   │       └── workspace.py ◄──── BACKEND (Reference)
│   │           ├── update_page()                 Line 308
│   │           ├── save_page()                   Line 286
│   │           └── delete_page()                 Line 413
│   │
│   └── ...
│
└── customizations/ ◄──────────── DOCUMENTATION
    ├── WORKSPACE_CUSTOMIZATION_REFERENCE.md     (Full guide)
    ├── QUICK_REFERENCE.md                       (Summary)
    └── VISUAL_DIAGRAMS.md                       (This file)
```

---

## Summary Legend

```
✅ = Allowed/Visible
❌ = Not Allowed/Hidden
||| = Conditional (depends on user role)
🔷 = Drag Handle
✎  = Edit Button
💾 = Save Button
```

---

**Last Updated: 2025-11-13**

For more details, see: `WORKSPACE_CUSTOMIZATION_REFERENCE.md` and `QUICK_REFERENCE.md`
