# Workspace Customization - Quick Reference Guide

## 📌 At a Glance

**Objective:** Users can edit their own private workspaces without Workspace Manager role

**Modified File:** `/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/views/workspace/workspace.js`

**Functions Changed:** 7 functions, ~50 lines total

---

## 🎯 Permission Rules Summary

```
PRIVATE WORKSPACE:
├─ Owner:           ✅ Can edit content, ✅ Can edit sidebar
├─ Other User:      ❌ No access
└─ Workspace Mgr:   ✅ Can edit content, ✅ Can edit sidebar

PUBLIC WORKSPACE:
├─ Regular User:    ❌ No edit access, ❌ No edit button
├─ Workspace Mgr:   ✅ Can edit content, ❌ No sidebar edit
└─ Default Sidebar: Always used (not customizable)
```

---

## 📝 Changes at a Glance

| Line | Function | What Changed | Why |
|------|----------|--------------|-----|
| 189 | `setup_pages()` | `page.is_editable = (!page.public && page.for_user === frappe.session.user) \|\| this.has_access;` | Check workspace owner |
| 1633 | `open_workspace_window()` | Edit button hidden for non-managers on public workspaces | Prevent non-managers from seeing edit UI |
| 1848 | `save_main_workspace()` | Send `page.title` instead of `page.name` | Backend expects title only |
| 3063-3077 | `toggle_window_edit_mode()` | Only edit sidebar if `!page.public` | Restrict sidebar editing on public |
| 3123-3131 | `save_both_workspace_and_sidebar()` | Only save sidebar if `!page.public` | Prevent public sidebar modifications |
| 2196, 2199 | `render_sidebar()` | Add conditional `is-draggable` class | Prevent drag-drop on public sidebars |
| 2283 | `setup_sidebar_sortable()` | Skip if `page.public` | Prevent reordering on public workspaces |

---

## 🔐 Critical Backend Checks (For Reference)

**File:** `/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace/workspace.py`

- **Line 312-316** in `update_page()`: Prevents non-owner from editing other user's private workspace
- **Line 424-430** in `delete_page()`: Prevents non-owner from deleting other user's workspace
- **Line 291-292** in `save_page()`: Filters by owner when saving private workspace content

These backend checks are **essential** - they prevent users from bypassing frontend restrictions.

---

## 💾 Doctypes Used

1. **Workspace** - Main workspace document
   - `public` (Check): 1 = public, 0 = private
   - `for_user` (Link): Owner username (private workspaces only)
   - `content` (LongText): EditorJS JSON

2. **Workspace User Sidebar** - Custom sidebar per user per workspace
   - `workspace` (Link): Which workspace
   - `user` (Link): Which user
   - `links` (Table): Custom links in custom order

---

## 🧪 Quick Test Cases

### Test 1: Regular User with Private Workspace
```
1. User A creates workspace "My Dashboard"
   → Stored as "My Dashboard-user_a@example.com"
   → for_user = user_a@example.com

2. User A can:
   ✅ See edit button
   ✅ Edit content
   ✅ Edit sidebar (add/remove/reorder links)
   ✅ Save changes

3. User B cannot:
   ❌ See User A's workspace (unless shared)
   ❌ Edit User A's workspace
```

### Test 2: Public Workspace (Workspace Manager)
```
1. Manager creates workspace "Company Dashboard"
   → Stored as "Company Dashboard"
   → for_user = "" (empty)
   → public = 1

2. Manager can:
   ✅ See edit button
   ✅ Edit content
   ❌ Edit sidebar (disabled)

3. Regular User:
   ❌ Cannot see edit button
   ❌ Cannot edit content
   ✅ Can view workspace and default sidebar
```

### Test 3: Sidebar Customization
```
Private Workspace:
  ✅ User can drag-drop sidebar links
  ✅ Order saved in Workspace User Sidebar doctype

Public Workspace:
  ❌ Links not draggable
  ❌ Links come from Workspace.links table
  ❌ No customization saved
```

---

## 🔍 Most Important Code Sections

### 1. Permission Check (Line 189)
```javascript
page.is_editable = (!page.public && page.for_user === frappe.session.user) || this.has_access;
```
This ONE line determines if edit UI is shown.

### 2. Edit Button Visibility (Line 1633)
```javascript
style="${page.public && !this.has_access ? 'display: none;' : ''}"
```
This hides button for non-managers on public workspaces.

### 3. Sidebar Edit Mode (Line 3064)
```javascript
if (!page.public) {
    this.enter_sidebar_edit_mode($window, page);
}
```
This prevents sidebar edit mode on public workspaces.

### 4. Save Logic (Line 3124)
```javascript
if (!page.public) {
    this.save_sidebar_customizations($window, page);
}
```
This prevents sidebar saves on public workspaces.

---

## 🚨 Common Mistakes to Avoid

❌ **Don't** trust frontend-only permissions
- Backend checks are REQUIRED for security

❌ **Don't** modify backend without frontend changes
- Frontend and backend must stay in sync

❌ **Don't** send `page.name` to `save_page()`
- Always send `page.title`

❌ **Don't** allow sidebar customization on public workspaces
- Public sidebars should be read-only

❌ **Don't** skip the `for_user` field check
- It's critical for private workspace ownership

---

## 📂 File Structure

```
/home/corex/aurevia-bench/
├── apps/frappe/frappe/
│   ├── public/js/frappe/views/workspace/
│   │   └── workspace.js                    ← MAIN FILE MODIFIED
│   ├── desk/
│   │   ├── desktop.py                      ← Backend reference
│   │   └── doctype/workspace/
│   │       └── workspace.py                ← Backend reference
│   └── ...
└── customizations/
    ├── WORKSPACE_CUSTOMIZATION_REFERENCE.md ← Full documentation
    └── QUICK_REFERENCE.md                   ← This file
```

---

## 🔄 Data Flow Summary

```
User Action
    ↓
setup_pages() checks is_editable
    ↓
open_workspace_window() hides edit button if needed
    ↓
User clicks edit (if button visible)
    ↓
toggle_window_edit_mode() checks !page.public before sidebar edit
    ↓
User modifies content & sidebar
    ↓
save_both_workspace_and_sidebar() saves only if allowed:
├─ Content always saved (if user is owner/manager)
└─ Sidebar only saved if !page.public
    ↓
Backend validate_page() ensures for_user match
    ↓
Success/Error shown
```

---

## 🎓 For Future Developers

### To Understand the Changes:
1. Read WORKSPACE_CUSTOMIZATION_REFERENCE.md (full details)
2. Read this file (quick overview)
3. Review the actual code in workspace.js (lines 189, 1633, 1848, 3063-3077, 3123-3131, 2196, 2283)

### To Modify the Behavior:
1. Identify which function to change (see table above)
2. Check both frontend AND backend implications
3. Update both frontend and backend consistently
4. Test with the test cases above
5. Document your changes

### To Add New Permissions:
1. Modify `setup_pages()` is_editable logic
2. Update backend `get_workspace_sidebar_items()` if needed
3. Add permission checks in backend edit methods
4. Test permissions thoroughly

---

## 📞 Related Code References

**Frontend Workspace File:**
`/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/views/workspace/workspace.js`

- `setup_pages()` - Line 179
- `open_workspace_window()` - Line 1611
- `save_main_workspace()` - Line 1821
- `toggle_window_edit_mode()` - Line 3027
- `save_both_workspace_and_sidebar()` - Line 3118
- `render_sidebar()` - Line 2146
- `setup_sidebar_sortable()` - Line 2278

**Backend Files:**

`/home/corex/aurevia-bench/apps/frappe/frappe/desk/desktop.py`
- `get_workspace_sidebar_items()` - Line 488
- `get_user_sidebar_links()` - Line 757
- `save_user_sidebar()` - Line 865

`/home/corex/aurevia-bench/apps/frappe/frappe/desk/doctype/workspace/workspace.py`
- `update_page()` - Line 308
- `save_page()` - Line 286
- `delete_page()` - Line 413

---

## ✅ Verification Checklist

After making changes, verify:

- [ ] Private workspace owners can edit their workspaces
- [ ] Private workspace non-owners cannot edit
- [ ] Public workspace non-managers cannot see edit button
- [ ] Public workspace managers can edit content but not sidebar
- [ ] Sidebar customizations saved only for private workspaces
- [ ] Drag-drop works for private, not for public
- [ ] Backend permission checks are enforced
- [ ] No console errors on permission checks
- [ ] Changes persist after refresh
- [ ] Cache clears appropriately after saves

---

**Last Updated: 2025-11-13**

For detailed information, see: `WORKSPACE_CUSTOMIZATION_REFERENCE.md`
