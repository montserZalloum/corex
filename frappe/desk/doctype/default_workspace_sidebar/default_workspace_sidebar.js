frappe.ui.form.on('Default Workspace Sidebar', {
  refresh(frm) {
      frm.set_query('workspace', () => {
          return {
              filters: { public: 1 }  // Only show public workspaces
          };
      });
  }
});
