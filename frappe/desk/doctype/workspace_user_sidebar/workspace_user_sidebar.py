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

		# Update last modified timestamp
		self.last_modified = frappe.utils.now()

	def validate_link_permissions(self):
		"""Validate that user has permission for all links"""
		for link in self.sidebar_links:
			if not has_permission_for_link_row(link):
				frappe.throw(
					_("You don't have permission to add {0} to your sidebar").format(link.label),
					frappe.PermissionError
				)


def has_permission_for_link_row(link):
	"""
	Check if current user has permission to access a link
	Returns True if accessible, False if not
	"""
	link_type = link.link_type
	link_to = link.link_to

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
