# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class WorkspaceUserSidebar(Document):
	def validate(self):
		"""Validate the document before saving"""
		# Ensure user can only create/modify their own sidebar
		if self.user != frappe.session.user and not frappe.has_permission("Workspace User Sidebar", ptype="write"):
			frappe.throw(_("You can only customize your own workspace sidebar"), frappe.PermissionError)

		# Validate that workspace exists and user has access
		if not frappe.db.exists("Workspace", self.workspace):
			frappe.throw(_("Workspace {0} does not exist").format(self.workspace))

		workspace_doc = frappe.get_doc("Workspace", self.workspace)

		# For private workspaces, ensure user owns it
		if not workspace_doc.public:
			if workspace_doc.for_user != frappe.session.user:
				frappe.throw(_("You can only customize private workspaces that you own"), frappe.PermissionError)

		# Validate all links have permission
		self.validate_link_permissions()

		# Validate only one default link
		self.validate_only_one_default_link()

		# Update last modified timestamp
		self.last_modified = frappe.utils.now()

	# --- CACHE INVALIDATION START ---
	def on_update(self):
		"""Clear cache when sidebar is saved or reordered"""
		self.clear_sidebar_cache()

	def on_trash(self):
		"""Clear cache when sidebar is deleted"""
		self.clear_sidebar_cache()

	def clear_sidebar_cache(self):
		"""Delete the specific cache key for this user/workspace combination"""
		# Key format matches the one used in get_user_sidebar_links
		cache_key = f"sidebar_data::{self.user}::{self.workspace}"
		frappe.cache().delete_value(cache_key)
	# --- CACHE INVALIDATION END ---

	def validate_link_permissions(self):
		"""Validate that user has permission for all links"""
		for link in self.sidebar_links:
			if not has_permission_for_link_row(link):
				frappe.throw(
					_("You don't have permission to add {0} to your sidebar").format(link.label),
					frappe.PermissionError
				)

	def validate_only_one_default_link(self):
		"""Ensure only one link is marked as default"""
		default_links = [link for link in self.sidebar_links if link.is_default]

		if len(default_links) > 1:
			frappe.throw(
				_("Only one sidebar link can be marked as default. Please uncheck the others."),
				frappe.ValidationError
			)


def has_permission_for_link_row(link):
	"""
	Check if current user has permission to access a link
	Returns True if accessible, False if not
	"""
	link_type = link.link_type
	link_to = link.link_to

	# Category links are just headers, no permission check needed
	if link_type == "Category":
		return True

	# Skip if link_to is empty (for URLs)
	if link_type == "URL":
		return True

	if not link_to:
		return False

	try:
		if link_type == "DocType":
			# Check if user has read permission for this DocType
			return frappe.has_permission(link_to, ptype="read") or False

		elif link_type == "Page":
			# Check if page exists and user can access it
			if not frappe.db.exists("Page", link_to):
				return False

			page = frappe.get_doc("Page", link_to)

			# Check if page has roles defined
			if page.roles:
				user_roles = frappe.get_roles()
				page_roles = [role.role for role in page.roles]
				return any(role in page_roles for role in user_roles)

			# If no roles defined, page is public
			return True

		elif link_type == "Report":
			# Check if report exists
			if not frappe.db.exists("Report", link_to):
				return False

			report = frappe.get_doc("Report", link_to)

			# Check report permissions based on ref_doctype
			if report.ref_doctype:
				return frappe.has_permission(report.ref_doctype, ptype="read") or False

			# Check if user has roles assigned to report
			if report.roles:
				user_roles = frappe.get_roles()
				report_roles = [role.role for role in report.roles]
				return any(role in report_roles for role in user_roles)

			return True

		else:
			# Unknown link type - deny by default
			return False

	except Exception as e:
		# Log error but don't expose to user
		frappe.log_error(f"Permission check failed for {link_type}: {link_to}", "Sidebar Permission Error")
		return False


@frappe.whitelist()
def update_sidebar_links_order(workspace, links_order):
	"""
	Update the order of links in a workspace user sidebar.
	No permission checks needed - users can only see their own private workspaces.
	"""
	links_order = frappe.parse_json(links_order)
	user = frappe.session.user

	# Get the user's sidebar for this workspace
	sidebar_name = frappe.db.get_value(
		"Workspace User Sidebar",
		{"user": user, "workspace": workspace},
		"name"
	)

	if not sidebar_name:
		frappe.throw(_("Sidebar not found for this workspace"))

	# Get the existing sidebar document
	sidebar_doc = frappe.get_doc("Workspace User Sidebar", sidebar_name)

	# Clear existing links
	sidebar_doc.sidebar_links = []

	# Rebuild links in the new order
	for idx, link_data in enumerate(links_order):
		sidebar_doc.append("sidebar_links", {
			"link_type": link_data.get("link_type"),
			"link_to": link_data.get("link_to"),
			"label": link_data.get("label"),
			"icon": link_data.get("icon"),
			"is_custom": link_data.get("is_custom", 0),
			"is_default": link_data.get("is_default", 0),
			"idx": idx + 1,
			"doc_view": link_data.get("doc_view"),
			"kanban_board": link_data.get("kanban_board"),
			"color": link_data.get("color"),
			"stats_filter": link_data.get("stats_filter")
		})

	# Save the updated document
	sidebar_doc.save(ignore_permissions=True)

	return {
		"success": True,
		"message": _("Sidebar links order updated")
	}
