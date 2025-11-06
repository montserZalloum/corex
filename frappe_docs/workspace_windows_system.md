# Workspace Windows System - OS-Like Desktop Experience

## Overview

The Workspace Windows System transforms Frappe's workspace navigation into a Windows-style desktop environment where each workspace opens as an independent floating window. Users can manage multiple workspaces simultaneously, just like opening multiple folders on an operating system.

## Feature Description

### Core Functionality

**Desktop Background**
- The main workspace page displays a beautiful gradient background (blue to green)
- Workspace icons are shown in the sidebar as desktop items
- No page content renders on the main view — only workspace navigation

**Floating Windows**
- Clicking a workspace icon opens a new floating window
- Each window is independent and can be dragged anywhere on the desktop
- Windows can be minimized, maximized, and closed
- Multiple windows can be open simultaneously
- New windows automatically appear on top with proper z-index stacking

**Window Controls**
- **← (Back)**: Return to workspace view from a page
- **_ (Minimize)**: Hide window content while keeping the titlebar
- **□ (Maximize)**: Toggle between windowed and fullscreen modes with position restoration
- **× (Close)**: Close the window and clean up associated content

**Navigation Within Windows**
- Clicking items inside a workspace opens content in the same window (no navigation away from desktop)
- Breadcrumb trail in titlebar shows: `Workspace Name > Page Name`
- Back button appears when viewing page content
- Desktop remains visible when window is open
- Route history is tracked per-window for proper back navigation

**Smart Dragging**
- Click and drag the titlebar to move windows around
- Windows are constrained to viewport boundaries
- Dragging brings window to front automatically
- No conflicts with page content during drag operations

## Technical Implementation

### Modified Files

#### 1. `/home/corex/aurevia-bench/apps/frappe/frappe/public/js/frappe/views/workspace/workspace.js`

**Changes:**
- Added `window_z_index` property to track and manage window stacking
- Implemented `open_workspace_window()` method to create floating windows with HTML structure
- Added window dragging with `make_window_draggable()` method with per-window drag state
- Implemented window control handlers (minimize, maximize, close)
- Created `setup_window_routing()` to intercept Frappe's page routing
- Added `show_page_in_window()` to display pages inside windows via cloning
- Implemented breadcrumb updates with `update_window_breadcrumb()`
- Added `show_workspace_content_in_window()` for back navigation
- Enhanced `initialize_window_editor()` with element existence checks and error handling
- Modified sidebar click handler to open windows instead of navigating

**Key Features:**
```javascript
// Z-index management
this.window_z_index = 1000;
this.window_z_index += 1;

// Drag state (per-window)
const dragState = { isDown: false, offset: [0, 0] };

// Page cloning to avoid DOM hierarchy issues
const $pageClone = $page.clone(true, true);

// Drag flag to prevent routing during movement
$window.data("is-dragging", true/false);

// Route history tracking (per-window)
$window.data("route-history", []);
```

#### 2. `/home/corex/aurevia-bench/apps/frappe/frappe/public/scss/desk/workspace_windows.scss`

**New File:** Comprehensive SCSS styling for the workspace windows system

**Features:**
- Windows 11 inspired design with modern aesthetics
- Blue gradient titlebar (`#0078d4` to `#107c10`)
- Smooth animations for window opening (slideIn)
- Responsive design for desktop, tablet, and mobile
- Custom scrollbar styling
- Loading indicator with spinning animation
- Window shadows (light, medium, heavy) for depth
- Hover and focus states for accessibility
- Print-friendly styles

**Animation Classes:**
- `slideIn`: 300ms elastic entrance animation
- `spin`: Loading spinner animation
- `dragging`: Enhanced shadow during drag

#### 3. `/home/corex/aurevia-bench/apps/frappe/frappe/public/scss/desk/index.scss`

**Change:** Added import for workspace windows styling
```scss
@import "workspace_windows";
```

## User Interface

### Desktop Layout
```
┌─────────────────────────────────────────────────────────────┐
│                   GRADIENT BACKGROUND                       │
│                (Blue to Green with subtle gloss)             │
│                                                               │
│    [Workspace Icons in Sidebar]                              │
│                                                               │
│                  ┌─────────────────────────┐                 │
│                  │ Users               _ □ ×│                 │
│                  ├─────────────────────────┤                 │
│                  │                         │                 │
│                  │  [Workspace Content]    │                 │
│                  │  or Page Content        │                 │
│                  │                         │                 │
│                  └─────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

### Window Titlebar
```
┌─────────────────────────────────────────────────────────────┐
│ Users > User List            ← _ □ ×                         │
└─────────────────────────────────────────────────────────────┘
```

## User Workflows

### Opening a Workspace
1. User sees desktop with workspace icons in sidebar
2. Clicks a workspace icon (e.g., "Users")
3. New floating window opens with workspace content
4. Window appears on top with proper stacking

### Navigating Within a Window
1. User clicks an item in workspace (e.g., "User List" card)
2. Content loads inside the same window
3. Breadcrumb shows: "Users > User List"
4. Back button (←) appears in titlebar
5. Clicking back returns to workspace view

### Managing Multiple Windows
1. User can open "Users" workspace in Window A
2. Open "Integration" workspace in Window B
3. Both windows remain independent
4. Drag windows to arrange desktop
5. Minimize, maximize, or close as needed

### Dragging Windows
1. Click titlebar (not on buttons) and drag
2. Window follows cursor smoothly
3. Constrained to viewport boundaries
4. Window brings itself to front during drag
5. Release to place window

## Performance Considerations

- **Z-index Management**: Incremental z-index prevents stacking context issues
- **Page Cloning**: Pages are cloned for display, keeping originals in Frappe's container
- **Event Namespacing**: Used `.workspace-window` namespaced events for clean event management
- **Per-Window State**: Each window maintains its own drag state, preventing conflicts
- **Drag Guards**: `is-dragging` flag prevents unintended routing during window movement

## Browser Support

- Chrome/Edge: Full support with modern CSS and animations
- Firefox: Full support
- Safari: Full support with webkit prefixes
- Mobile: Responsive design with adjusted window sizes

## Future Enhancements

- Window state persistence (localStorage)
- Snap-to-grid alignment
- Window resizing from edges
- Window minimize/restore animation
- Keyboard shortcuts (Win+↑ for maximize, etc.)
- Window transparency/opacity control
- Multi-monitor support awareness

## Accessibility

- Focus states with blue outline on window focus
- Proper ARIA labels on buttons
- Keyboard navigation support
- High contrast gradient for visibility
- Clear visual feedback for interactions

## Dependencies

- jQuery (existing Frappe dependency)
- EditorJS (for workspace content rendering)
- SCSS compilation (Frappe build system)
- No additional external libraries required

## Notes

- Original Frappe page routing is preserved and used as fallback
- Workspace pages remain in Frappe's main container via cloning approach
- Core workspace functionality is enhanced, not replaced
- All changes are non-destructive to existing Frappe features
