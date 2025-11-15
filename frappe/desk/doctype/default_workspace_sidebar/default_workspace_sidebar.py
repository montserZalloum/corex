# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class DefaultWorkspaceSidebar(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.desk.doctype.workspace_user_sidebar_link.workspace_user_sidebar_link import WorkspaceUserSidebarLink
		from frappe.types import DF

		sidebar_links: DF.Table[WorkspaceUserSidebarLink]
		workspace: DF.Link
	# end: auto-generated types
	def validate(self):
		"""Validate the document before saving"""
		# Ensure the workspace exists
		if not frappe.db.exists("Workspace", self.workspace):
			frappe.throw(_("Workspace {0} does not exist").format(self.workspace))

		workspace_doc = frappe.get_doc("Workspace", self.workspace)

		# Only allow default sidebars for public workspaces
		if not workspace_doc.public:
			frappe.throw(
				_("Default Workspace Sidebar can only be created for public workspaces"),
				frappe.ValidationError
			)

		# Validate all links have required permissions
		self.validate_link_permissions()

		# Validate only one default link
		self.validate_only_one_default_link()

	def validate_link_permissions(self):
		"""Validate that the links in default sidebar are accessible"""
		for link in self.sidebar_links:
			if not self.has_permission_for_link(link):
				frappe.throw(
					_("Link {0} is not accessible. Check permissions for {1}").format(
						link.label, link.link_to
					),
					frappe.PermissionError
				)

	def has_permission_for_link(self, link):
		"""Check if the link is valid and accessible"""
		link_type = link.link_type
		link_to = link.link_to

		# Skip URL validation
		if link_type == "URL":
			return True

		if not link_to:
			return False

		try:
			if link_type == "DocType":
				# Check if DocType exists
				return frappe.db.exists("DocType", link_to)

			elif link_type == "Page":
				# Check if page exists
				return frappe.db.exists("Page", link_to)

			elif link_type == "Report":
				# Check if report exists
				return frappe.db.exists("Report", link_to)

			else:
				return False

		except Exception as e:
			frappe.log_error(
				f"Validation check failed for {link_type}: {link_to}\n{str(e)}",
				"Default Workspace Sidebar Validation"
			)
			return False

	def validate_only_one_default_link(self):
		"""Ensure only one link is marked as default"""
		default_links = [link for link in self.sidebar_links if link.is_default]

		if len(default_links) > 1:
			frappe.throw(
				_("Only one sidebar link can be marked as default. Please uncheck the others."),
				frappe.ValidationError
			)
