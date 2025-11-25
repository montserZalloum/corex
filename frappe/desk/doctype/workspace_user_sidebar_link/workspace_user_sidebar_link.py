# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
import json
from frappe.model.document import Document


class WorkspaceUserSidebarLink(Document):
	def validate(self):
		"""Validate based on link type"""
		# Reset non-category fields if link_type is Category
		if self.link_type == "Category":
			self.reset_category_fields()
			return

		self.validate_stats_filter()
		self.validate_kanban_board()

	def reset_category_fields(self):
		"""Reset all non-category fields to default values for Category links"""
		self.link_to = ""
		self.doc_view = ""
		self.kanban_board = ""
		self.stats_filter = ""
		self.is_custom = 0
		self.is_default = 0

	def validate_stats_filter(self):
		"""Validate that stats_filter contains valid JSON"""
		if self.stats_filter:
			try:
				json.loads(self.stats_filter)
			except (json.JSONDecodeError, ValueError) as e:
				frappe.throw(
					frappe._("Invalid JSON in Count Filter: {0}").format(str(e))
				)

	def validate_kanban_board(self):
		"""Validate that kanban_board is required when doc_view is Kanban"""
		if self.doc_view == "Kanban" and not self.kanban_board:
			frappe.throw(
				frappe._("Kanban Board is required when DocType View is set to Kanban")
			)
