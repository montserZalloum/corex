frappe.ui.form.on('Workspace User Sidebar Link', {
	link_type(frm) {
		const isCategory = frm.doc.link_type === 'Category';

		// Clear link_to and uncheck is_default when switching to Category
		if (isCategory) {
			frm.set_value('link_to', '');
			frm.set_value('is_default', 0);
		}
	}
});
