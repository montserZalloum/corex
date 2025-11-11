# Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE
# Author - Shivam Mishra <shivam@frappe.io>

from functools import wraps
from json import dumps, loads

import frappe
from frappe import DoesNotExistError, ValidationError, _, _dict
from frappe.boot import get_allowed_pages, get_allowed_reports
from frappe.cache_manager import (
	build_domain_restriced_doctype_cache,
	build_domain_restriced_page_cache,
	build_table_count_cache,
)
from frappe.core.doctype.custom_role.custom_role import get_custom_allowed_roles


def handle_not_exist(fn):
	@wraps(fn)
	def wrapper(*args, **kwargs):
		try:
			return fn(*args, **kwargs)
		except DoesNotExistError:
			frappe.clear_last_message()
			return []

	return wrapper


class Workspace:
	def __init__(self, page, minimal=False):
		self.page_name = page.get("name")
		self.page_title = page.get("title")
		self.public_page = page.get("public")
		self.workspace_manager = "Workspace Manager" in frappe.get_roles()

		self.user = frappe.get_user()
		self.allowed_modules = self.get_cached("user_allowed_modules", self.get_allowed_modules)

		self.doc = frappe.get_cached_doc("Workspace", self.page_name)
		if (
			self.doc
			and self.doc.module
			and self.doc.module not in self.allowed_modules
			and not self.workspace_manager
		):
			raise frappe.PermissionError

		self.can_read = self.get_cached("user_perm_can_read", self.get_can_read_items)

		if not minimal:
			self.allowed_pages = get_allowed_pages(cache=True)
			self.allowed_reports = get_allowed_reports(cache=True)

			if self.doc.content:
				self.onboarding_list = [
					x["data"]["onboarding_name"] for x in loads(self.doc.content) if x["type"] == "onboarding"
				]
			self.onboardings = []

			self.table_counts = get_table_with_counts()
		self.restricted_doctypes = (
			frappe.cache.get_value("domain_restricted_doctypes") or build_domain_restriced_doctype_cache()
		)
		self.restricted_pages = (
			frappe.cache.get_value("domain_restricted_pages") or build_domain_restriced_page_cache()
		)

	def is_permitted(self):
		"""Returns true if Has Role is not set or the user is allowed."""
		from frappe.utils import has_common

		allowed = [d.role for d in self.doc.roles]

		custom_roles = get_custom_allowed_roles("page", self.doc.name)
		allowed.extend(custom_roles)

		if not allowed:
			return True

		roles = frappe.get_roles()

		if has_common(roles, allowed):
			return True

	def get_cached(self, cache_key, fallback_fn):
		value = frappe.cache.get_value(cache_key, user=frappe.session.user)
		if value is not None:
			return value

		value = fallback_fn()

		# Expire every six hour
		frappe.cache.set_value(cache_key, value, frappe.session.user, 21600)
		return value

	def get_can_read_items(self):
		if not self.user.can_read:
			self.user.build_permissions()

		return self.user.can_read

	def get_allowed_modules(self):
		if not self.user.allow_modules:
			self.user.build_permissions()

		return self.user.allow_modules

	def get_onboarding_doc(self, onboarding):
		# Check if onboarding is enabled
		if not frappe.get_system_settings("enable_onboarding"):
			return None

		if not self.onboarding_list:
			return None

		if frappe.db.get_value("Module Onboarding", onboarding, "is_complete"):
			return None

		doc = frappe.get_doc("Module Onboarding", onboarding)

		# Check if user is allowed
		allowed_roles = set(doc.get_allowed_roles())
		user_roles = set(frappe.get_roles())
		if not allowed_roles & user_roles:
			return None

		# Check if already complete
		if doc.check_completion():
			return None

		return doc

	def is_item_allowed(self, name, item_type):
		if frappe.session.user == "Administrator":
			return True

		item_type = item_type.lower()

		if item_type == "doctype":
			return name in (self.can_read or []) and name in (self.restricted_doctypes or [])
		if item_type == "page":
			if not self.allowed_pages:
				self.allowed_pages = get_allowed_pages(cache=True)
			return name in self.allowed_pages and name in self.restricted_pages
		if item_type == "report":
			if not self.allowed_reports:
				self.allowed_reports = get_allowed_reports(cache=True)
			return name in self.allowed_reports
		if item_type == "help":
			return True
		if item_type == "dashboard":
			return True
		if item_type == "url":
			return True

		return False

	def build_workspace(self):
		self.cards = {"items": self.get_links()}
		self.charts = {"items": self.get_charts()}
		self.shortcuts = {"items": self.get_shortcuts()}
		self.onboardings = {"items": self.get_onboardings()}
		self.quick_lists = {"items": self.get_quick_lists()}
		self.number_cards = {"items": self.get_number_cards()}
		self.custom_blocks = {"items": self.get_custom_blocks()}

	def _doctype_contains_a_record(self, name):
		exists = self.table_counts.get(name, False)

		if not exists and frappe.db.exists(name):
			if not frappe.db.get_value("DocType", name, "issingle"):
				exists = bool(frappe.get_all(name, limit=1))
			else:
				exists = True
			self.table_counts[name] = exists

		return exists

	def _prepare_item(self, item):
		if item.dependencies:
			dependencies = [dep.strip() for dep in item.dependencies.split(",")]

			incomplete_dependencies = [d for d in dependencies if not self._doctype_contains_a_record(d)]

			if len(incomplete_dependencies):
				item.incomplete_dependencies = incomplete_dependencies
			else:
				item.incomplete_dependencies = ""

		if item.onboard:
			# Mark Spotlights for initial
			if item.get("type") == "doctype":
				name = item.get("name")
				count = self._doctype_contains_a_record(name)

				item["count"] = count

		if item.get("link_type") == "DocType":
			item["description"] = frappe.get_meta(item.link_to).description

		# Translate label
		item["label"] = _(item.label) if item.label else _(item.name)

		return item

	def is_custom_block_permitted(self, custom_block_name):
		from frappe.utils import has_common

		allowed = [
			d.role for d in frappe.get_all("Has Role", fields=["role"], filters={"parent": custom_block_name})
		]

		if not allowed:
			return True

		roles = frappe.get_roles()

		if has_common(roles, allowed):
			return True

		return False

	@handle_not_exist
	def get_links(self):
		cards = self.doc.get_link_groups()

		if not self.doc.hide_custom:
			cards = cards + get_custom_reports_and_doctypes(self.doc.module)

		default_country = frappe.db.get_default("country")

		new_data = []
		for card in cards:
			new_items = []
			card = _dict(card)

			links = card.get("links", [])

			for item in links:
				item = _dict(item)

				# Condition: based on country
				if item.country and item.country != default_country:
					continue

				# Check if user is allowed to view
				if self.is_item_allowed(item.link_to, item.link_type):
					prepared_item = self._prepare_item(item)
					new_items.append(prepared_item)

			if new_items:
				if isinstance(card, _dict):
					new_card = card.copy()
				else:
					new_card = card.as_dict().copy()
				new_card["links"] = new_items
				new_card["label"] = _(new_card["label"])
				new_data.append(new_card)

		return new_data

	@handle_not_exist
	def get_charts(self):
		all_charts = []
		if frappe.has_permission("Dashboard Chart", throw=False):
			charts = self.doc.charts

			for chart in charts:
				if frappe.has_permission("Dashboard Chart", doc=chart.chart_name):
					# Translate label
					chart.label = _(chart.label) if chart.label else _(chart.chart_name)
					all_charts.append(chart)

		return all_charts

	@handle_not_exist
	def get_shortcuts(self):
		def _in_active_domains(item):
			if not item.restrict_to_domain:
				return True
			else:
				return item.restrict_to_domain in frappe.get_active_domains()

		items = []
		shortcuts = self.doc.shortcuts

		for item in shortcuts:
			new_item = item.as_dict().copy()
			if self.is_item_allowed(item.link_to, item.type) and _in_active_domains(item):
				if item.type == "Report":
					report = self.allowed_reports.get(item.link_to, {})
					if report.get("report_type") in ["Query Report", "Script Report", "Custom Report"]:
						new_item["is_query_report"] = 1
					else:
						new_item["ref_doctype"] = report.get("ref_doctype")

				# Translate label
				new_item["label"] = _(item.label) if item.label else _(item.link_to)

				items.append(new_item)

		return items

	@handle_not_exist
	def get_quick_lists(self):
		items = []
		quick_lists = self.doc.quick_lists

		for item in quick_lists:
			if self.is_item_allowed(item.document_type, "doctype"):
				new_item = item.as_dict().copy()

				# Translate label
				new_item["label"] = _(item.label) if item.label else _(item.document_type)

				items.append(new_item)

		return items

	@handle_not_exist
	def get_onboardings(self):
		if self.onboarding_list:
			for onboarding in self.onboarding_list:
				onboarding_doc = self.get_onboarding_doc(onboarding)
				if onboarding_doc:
					item = {
						"label": _(onboarding),
						"title": _(onboarding_doc.title),
						"subtitle": _(onboarding_doc.subtitle),
						"success": _(onboarding_doc.success_message),
						"docs_url": onboarding_doc.documentation_url,
						"items": self.get_onboarding_steps(onboarding_doc),
					}
					self.onboardings.append(item)
		return self.onboardings

	@handle_not_exist
	def get_onboarding_steps(self, onboarding_doc):
		steps = []
		for doc in onboarding_doc.get_steps():
			step = doc.as_dict().copy()
			step.label = _(doc.title)
			if step.action == "Create Entry":
				step.is_submittable = frappe.db.get_value(
					"DocType", step.reference_document, "is_submittable", cache=True
				)
			steps.append(step)

		return steps

	@handle_not_exist
	def get_number_cards(self):
		all_number_cards = []
		if frappe.has_permission("Number Card", throw=False):
			number_cards = self.doc.number_cards
			for number_card in number_cards:
				if frappe.has_permission("Number Card", doc=number_card.number_card_name):
					# Translate label
					number_card.label = (
						_(number_card.label) if number_card.label else _(number_card.number_card_name)
					)
					all_number_cards.append(number_card)

		return all_number_cards

	@handle_not_exist
	def get_custom_blocks(self):
		all_custom_blocks = []
		if frappe.has_permission("Custom HTML Block", throw=False):
			custom_blocks = self.doc.custom_blocks

			for custom_block in custom_blocks:
				if frappe.has_permission("Custom HTML Block", doc=custom_block.custom_block_name):
					if not self.is_custom_block_permitted(custom_block.custom_block_name):
						continue

					# Translate label
					custom_block.label = (
						_(custom_block.label) if custom_block.label else _(custom_block.custom_block_name)
					)
					all_custom_blocks.append(custom_block)

		return all_custom_blocks


@frappe.whitelist()
@frappe.read_only()
def get_desktop_page(page):
	"""Applies permissions, customizations and returns the configruration for a page
	on desk.

	Args:
	        page (json): page data

	Returns:
	        dict: dictionary of cards, charts and shortcuts to be displayed on website
	"""
	try:
		workspace = Workspace(loads(page))
		workspace.build_workspace()
		return {
			"charts": workspace.charts,
			"shortcuts": workspace.shortcuts,
			"cards": workspace.cards,
			"onboardings": workspace.onboardings,
			"quick_lists": workspace.quick_lists,
			"number_cards": workspace.number_cards,
			"custom_blocks": workspace.custom_blocks,
		}
	except DoesNotExistError:
		frappe.log_error("Workspace Missing")
		return {}


@frappe.whitelist()
def get_doctype_workspace(doctype):
	"""
	Find the workspace that contains a given DocType.
	Uses the DocType's module to find the corresponding workspace.

	Args:
		doctype (str): Name of the DocType

	Returns:
		dict: Workspace info with 'name' and 'public' keys, or None if not found
	"""
	try:
		# Get DocType metadata
		meta = frappe.get_meta(doctype)

		if not meta:
			return None

		# Get the module name
		module = meta.module

		# Try to find workspace by module name
		# Workspaces are often named after their module
		workspace = frappe.db.get_value(
			"Workspace",
			{"module": module},
			["name", "title", "public"],
			as_dict=True
		)

		if workspace:
			return {
				"name": workspace.title,
				"public": workspace.public
			}

		# Fallback: Check if any workspace has a link to this DocType
		workspace_links = frappe.get_all(
			"Workspace Link",
			filters={
				"link_type": "DocType",
				"link_to": doctype
			},
			fields=["parent"],
			limit=1
		)

		if workspace_links:
			workspace_name = workspace_links[0].parent
			workspace = frappe.db.get_value(
				"Workspace",
				workspace_name,
				["title", "public"],
				as_dict=True
			)

			if workspace:
				return {
					"name": workspace.title,
					"public": workspace.public
				}

		return None

	except Exception as e:
		frappe.log_error(f"Error finding workspace for DocType {doctype}: {str(e)}")
		return None


@frappe.whitelist()
def get_workspace_sidebar_items():
	"""Get list of sidebar items for desk"""
	has_access = "Workspace Manager" in frappe.get_roles()

	# don't get domain restricted pages
	blocked_modules = frappe.get_cached_doc("User", frappe.session.user).get_blocked_modules()
	blocked_modules.append("Dummy Module")

	# adding None to allowed_domains to include pages without domain restriction
	allowed_domains = [None, *frappe.get_active_domains()]

	filters = {
		"restrict_to_domain": ["in", allowed_domains],
		"module": ["not in", blocked_modules],
	}

	if has_access:
		filters = []

	# pages sorted based on sequence id
	order_by = "sequence_id asc"
	fields = [
		"name",
		"title",
		"for_user",
		"parent_page",
		"content",
		"public",
		"module",
		"icon",
		"indicator_color",
		"is_hidden",
	]
	all_pages = frappe.get_all(
		"Workspace", fields=fields, filters=filters, order_by=order_by, ignore_permissions=True
	)
	pages = []
	private_pages = []

	# Filter Page based on Permission
	for page in all_pages:
		try:
			workspace = Workspace(page, True)
			if has_access or workspace.is_permitted():
				if page.public and (has_access or not page.is_hidden) and page.title != "Welcome Workspace":
					pages.append(page)
				elif page.for_user == frappe.session.user:
					private_pages.append(page)
				page["label"] = _(page.get("name"))
		except frappe.PermissionError:
			pass
	if private_pages:
		pages.extend(private_pages)

	if len(pages) == 0:
		pages = [frappe.get_doc("Workspace", "Welcome Workspace").as_dict()]
		pages[0]["label"] = _("Welcome Workspace")

	return {
		"pages": pages,
		"has_access": has_access,
		"has_create_access": frappe.has_permission(doctype="Workspace", ptype="create"),
	}


def get_table_with_counts():
	counts = frappe.cache.get_value("information_schema:counts")
	if not counts:
		counts = build_table_count_cache()

	return counts


def get_custom_reports_and_doctypes(module):
	return [
		_dict({"label": _("Custom Documents"), "links": get_custom_doctype_list(module)}),
		_dict({"label": _("Custom Reports"), "links": get_custom_report_list(module)}),
	]


def get_custom_doctype_list(module):
	doctypes = frappe.get_all(
		"DocType",
		fields=["name"],
		filters={"custom": 1, "istable": 0, "module": module},
		order_by="name",
	)

	return [
		{
			"type": "Link",
			"link_type": "doctype",
			"link_to": d.name,
			"label": _(d.name),
		}
		for d in doctypes
	]


def get_custom_report_list(module):
	"""Returns list on new style reports for modules."""
	reports = frappe.get_all(
		"Report",
		fields=["name", "ref_doctype", "report_type"],
		filters={"is_standard": "No", "disabled": 0, "module": module},
		order_by="name",
	)

	return [
		{
			"type": "Link",
			"link_type": "report",
			"doctype": r.ref_doctype,
			"dependencies": r.ref_doctype,
			"is_query_report": 1
			if r.report_type in ("Query Report", "Script Report", "Custom Report")
			else 0,
			"label": _(r.name),
			"link_to": r.name,
			"report_ref_doctype": r.ref_doctype,
		}
		for r in reports
	]


def save_new_widget(doc, page, blocks, new_widgets):
	if loads(new_widgets):
		widgets = _dict(loads(new_widgets))

		if widgets.chart:
			doc.charts.extend(new_widget(widgets.chart, "Workspace Chart", "charts"))
		if widgets.shortcut:
			doc.shortcuts.extend(new_widget(widgets.shortcut, "Workspace Shortcut", "shortcuts"))
		if widgets.quick_list:
			doc.quick_lists.extend(new_widget(widgets.quick_list, "Workspace Quick List", "quick_lists"))
		if widgets.custom_block:
			doc.custom_blocks.extend(
				new_widget(widgets.custom_block, "Workspace Custom Block", "custom_blocks")
			)
		if widgets.number_card:
			doc.number_cards.extend(new_widget(widgets.number_card, "Workspace Number Card", "number_cards"))
		if widgets.card:
			doc.build_links_table_from_card(widgets.card)

	# remove duplicate and unwanted widgets
	clean_up(doc, blocks)

	try:
		doc.save(ignore_permissions=True)
	except (ValidationError, TypeError) as e:
		# Create a json string to log
		json_config = widgets and dumps(widgets, sort_keys=True, indent=4)

		# Error log body
		log = f"""
		page: {page}
		config: {json_config}
		exception: {e}
		"""
		doc.log_error("Could not save customization", log)
		return False

	return True


def clean_up(original_page, blocks):
	page_widgets = {}

	for wid in ["shortcut", "card", "chart", "quick_list", "number_card", "custom_block"]:
		# get list of widget's name from blocks
		page_widgets[wid] = [x["data"][wid + "_name"] for x in loads(blocks) if x["type"] == wid]

	# shortcut, chart, quick_list, number_card & custom_block cleanup
	for wid in ["shortcut", "chart", "quick_list", "number_card", "custom_block"]:
		updated_widgets = []
		original_page.get(wid + "s").reverse()

		for w in original_page.get(wid + "s"):
			if w.label in page_widgets[wid] and w.label not in [x.label for x in updated_widgets]:
				updated_widgets.append(w)
		original_page.set(wid + "s", updated_widgets)

	# card cleanup
	for i, v in enumerate(original_page.links):
		if v.type == "Card Break" and v.label not in page_widgets["card"]:
			del original_page.links[i : i + v.link_count + 1]


def new_widget(config, doctype, parentfield):
	if not config:
		return []
	prepare_widget_list = []
	for idx, widget in enumerate(config):
		# Some cleanup
		widget.pop("name", None)

		# New Doc
		doc = frappe.new_doc(doctype)
		doc.update(widget)

		# Manually Set IDX
		doc.idx = idx + 1

		# Set Parent Field
		doc.parentfield = parentfield

		prepare_widget_list.append(doc)
	return prepare_widget_list


def prepare_widget(config, doctype, parentfield):
	"""Create widget child table entries with parent details

	Args:
	        config (dict): Dictionary containing widget config
	        doctype (string): Doctype name of the child table
	        parentfield (string): Parent field for the child table

	Returns:
	        TYPE: List of Document objects
	"""
	if not config:
		return []
	order = config.get("order")
	widgets = config.get("widgets")
	prepare_widget_list = []
	for idx, name in enumerate(order):
		wid_config = widgets[name].copy()
		# Some cleanup
		wid_config.pop("name", None)

		# New Doc
		doc = frappe.new_doc(doctype)
		doc.update(wid_config)

		# Manually Set IDX
		doc.idx = idx + 1

		# Set Parent Field
		doc.parentfield = parentfield

		prepare_widget_list.append(doc)
	return prepare_widget_list


@frappe.whitelist()
def update_onboarding_step(name, field, value):
	"""Update status of onboaridng step

	Args:
	        name (string): Name of the doc
	        field (string): field to be updated
	        value: Value to be updated

	"""
	from frappe.utils.telemetry import capture

	frappe.db.set_value("Onboarding Step", name, field, value)

	capture(frappe.scrub(name), app="frappe_onboarding", properties={field: value})


# ======================================
# Workspace User Sidebar Customization
# ======================================

@frappe.whitelist()
def get_user_sidebar_links(workspace_name):
	"""
	Get sidebar links for a workspace with permission filtering.
	Returns custom links if user has customized, otherwise returns defaults.
	"""
	user = frappe.session.user

	# Check if user has permission to access this workspace
	if not can_access_workspace(workspace_name):
		frappe.throw(_("You don't have permission to access this workspace"))

	# Check if user has customizations for this PUBLIC workspace
	custom_sidebar_name = frappe.db.get_value(
		"Workspace User Sidebar",
		{"user": user, "workspace": workspace_name},
		"name"
	)

	if custom_sidebar_name:
		# User has customizations - return filtered by permissions
		doc = frappe.get_doc("Workspace User Sidebar", custom_sidebar_name)

		# Filter links based on current permissions
		accessible_links = []
		for link in doc.sidebar_links:
			if has_permission_for_sidebar_link(link):
				accessible_links.append({
					"link_type": link.link_type,
					"link_to": link.link_to,
					"label": link.label,
					"icon": link.icon,
					"is_custom": link.is_custom,
					"idx": link.idx
				})

		hidden_links = frappe.parse_json(doc.hidden_default_links or "[]")

		return {
			"links": accessible_links,
			"hidden_links": hidden_links,
			"is_customized": True
		}
	else:
		# No customizations - return default from Workspace
		try:
			workspace = frappe.get_doc("Workspace", workspace_name)
		except frappe.DoesNotExistError:
			frappe.throw(_("Workspace {0} does not exist").format(workspace_name))

		# Get shortcuts and filter by permissions
		shortcuts = []
		for link in workspace.links:
			if link.type == "shortcut" and has_permission_for_workspace_link(link):
				shortcuts.append({
					"link_type": link.link_type or "DocType",
					"link_to": link.link_to,
					"label": link.label,
					"icon": link.icon,
					"is_custom": False
				})

		return {
			"links": shortcuts,
			"hidden_links": [],
			"is_customized": False
		}


@frappe.whitelist()
def save_user_sidebar(workspace_name, links, hidden_links=None):
	"""
	Save user's sidebar customizations for a public workspace.
	Validates permissions for all links before saving.
	"""
	user = frappe.session.user
	links = frappe.parse_json(links)
	hidden_links = frappe.parse_json(hidden_links or "[]")

	# Check workspace access first
	if not can_access_workspace(workspace_name):
		frappe.throw(_("You don't have permission to customize this workspace"))

	# Ensure it's a public workspace
	workspace_doc = frappe.get_doc("Workspace", workspace_name)
	if not workspace_doc.public:
		frappe.throw(_("Cannot customize private workspaces using this method. Edit the workspace directly."))

	# Find existing or create new
	existing = frappe.db.get_value(
		"Workspace User Sidebar",
		{"user": user, "workspace": workspace_name},
		"name"
	)

	if existing:
		doc = frappe.get_doc("Workspace User Sidebar", existing)
	else:
		doc = frappe.new_doc("Workspace User Sidebar")
		doc.user = user
		doc.workspace = workspace_name

	# Clear existing links
	doc.sidebar_links = []

	# Add links with proper idx and permission validation
	for idx, link in enumerate(links, start=1):
		# Validate user has permission for this link
		if not has_permission_for_link_dict(link):
			frappe.throw(_(f"You don't have permission to add {link.get('label')} to sidebar"))

		doc.append("sidebar_links", {
			"link_type": link.get("link_type"),
			"link_to": link.get("link_to"),
			"label": link.get("label"),
			"icon": link.get("icon"),
			"idx": idx,
			"is_custom": link.get("is_custom", 0)
		})

	doc.hidden_default_links = frappe.as_json(hidden_links)
	doc.save(ignore_permissions=True)  # We already validated permissions above

	return {"success": True, "message": _("Sidebar customizations saved")}


@frappe.whitelist()
def reset_user_sidebar(workspace_name):
	"""Remove user's sidebar customizations and revert to default"""
	user = frappe.session.user

	existing = frappe.db.get_value(
		"Workspace User Sidebar",
		{"user": user, "workspace": workspace_name},
		"name"
	)

	if existing:
		frappe.delete_doc("Workspace User Sidebar", existing, ignore_permissions=True)
		return {"success": True, "message": _("Sidebar reset to default")}

	return {"success": False, "message": _("No customizations found")}


# ======================================
# Workspace Creation and Duplication
# ======================================

@frappe.whitelist()
def create_private_workspace(title, icon=None, based_on=None):
	"""
	Create a new private workspace for the current user.
	Optionally based on a template workspace.
	"""
	user = frappe.session.user

	# Generate unique label for private workspace
	label = f"{title}-{user}"

	# Check if workspace with this label already exists
	if frappe.db.exists("Workspace", label):
		frappe.throw(_("You already have a workspace with this name"))

	# Create new workspace
	doc = frappe.new_doc("Workspace")
	doc.title = title
	doc.label = label
	doc.public = 0
	doc.for_user = user
	doc.icon = icon or "folder"
	doc.module = ""  # Remove module restriction for private workspaces

	# If based on a template, copy content
	if based_on:
		try:
			template = frappe.get_doc("Workspace", based_on)

			# Copy content (EditorJS JSON)
			if template.content:
				doc.content = template.content

			# Copy shortcuts
			for shortcut in template.shortcuts:
				if has_permission_for_workspace_link(shortcut):
					doc.append("shortcuts", {
						"type": shortcut.type,
						"link_to": shortcut.link_to,
						"label": shortcut.label,
						"icon": shortcut.icon,
						"doc_view": shortcut.doc_view,
						"color": shortcut.color,
						"format": shortcut.format,
						"stats_filter": shortcut.stats_filter
					})

			# Copy links
			for link in template.links:
				if has_permission_for_workspace_link(link):
					doc.append("links", {
						"type": link.type,
						"link_type": link.link_type,
						"link_to": link.link_to,
						"label": link.label,
						"icon": link.icon,
						"description": link.description,
						"is_query_report": link.is_query_report,
						"onboard": link.onboard
					})

			# Copy charts
			for chart in template.charts:
				doc.append("charts", {
					"chart_name": chart.chart_name,
					"label": chart.label
				})

			# Copy number cards
			for card in template.number_cards:
				doc.append("number_cards", {
					"document_type": card.document_type,
					"label": card.label,
					"function": card.function,
					"aggregate_function_based_on": card.aggregate_function_based_on,
					"filters_json": card.filters_json,
					"stats_time_interval": card.stats_time_interval
				})

		except Exception as e:
			frappe.log_error(f"Error copying workspace template: {str(e)}", "Workspace Creation Error")
			# Continue with blank workspace if template copy fails

	doc.insert(ignore_permissions=True)

	return {
		"success": True,
		"message": _("Workspace created successfully"),
		"workspace": {
			"name": doc.name,
			"label": doc.label,
			"title": doc.title,
			"icon": doc.icon
		}
	}


@frappe.whitelist()
def duplicate_workspace_to_private(workspace_name, new_title=None):
	"""
	Duplicate a public workspace as a private workspace for current user.
	This creates a full copy including content, links, and all widgets.
	"""
	user = frappe.session.user

	# Check if user has access to source workspace
	if not can_access_workspace(workspace_name):
		frappe.throw(_("You don't have permission to access this workspace"))

	# Get source workspace
	source = frappe.get_doc("Workspace", workspace_name)

	# Determine title for new workspace
	if not new_title:
		new_title = f"{source.title} (Copy)"

	# Create using create_private_workspace with template
	return create_private_workspace(
		title=new_title,
		icon=source.icon,
		based_on=workspace_name
	)


@frappe.whitelist()
def get_permitted_link_options():
	"""
	Get list of all DocTypes, Pages, and Reports user has access to.
	Used for "Add Link" dialog.
	"""
	permitted_items = {
		"doctypes": [],
		"pages": [],
		"reports": []
	}

	# Get permitted DocTypes
	for doctype in frappe.get_all("DocType", filters={"issingle": 0, "istable": 0}, fields=["name"]):
		if frappe.has_permission(doctype.name, ptype="read"):
			permitted_items["doctypes"].append({
				"value": doctype.name,
				"label": doctype.name
			})

	# Get permitted Pages
	user_roles = frappe.get_roles()
	for page in frappe.get_all("Page", fields=["name", "title"]):
		try:
			page_doc = frappe.get_doc("Page", page.name)
			if not page_doc.roles or any(role.role in user_roles for role in page_doc.roles):
				permitted_items["pages"].append({
					"value": page.name,
					"label": page.title or page.name
				})
		except:
			continue

	# Get permitted Reports
	for report in frappe.get_all("Report", fields=["name", "ref_doctype"]):
		try:
			if report.ref_doctype:
				if frappe.has_permission(report.ref_doctype, ptype="read"):
					permitted_items["reports"].append({
						"value": report.name,
						"label": report.name
					})
			else:
				# Check report roles
				report_doc = frappe.get_doc("Report", report.name)
				if not report_doc.roles or any(role.role in user_roles for role in report_doc.roles):
					permitted_items["reports"].append({
						"value": report.name,
						"label": report.name
					})
		except:
			continue

	return permitted_items


# ======================================
# Helper Functions for Permissions
# ======================================

def can_access_workspace(workspace_name):
	"""Check if current user can access this workspace"""
	try:
		workspace = frappe.get_doc("Workspace", workspace_name)

		# Check if workspace is public
		if workspace.public:
			# Check module-based permissions if module is set
			if workspace.module:
				# User needs access to the module
				has_module_access = frappe.has_permission(workspace.module, ptype="read")
				if not has_module_access:
					return False

			# Check role-based restrictions if roles are set
			if workspace.roles:
				user_roles = frappe.get_roles()
				workspace_roles = [role.role for role in workspace.roles]
				if not any(role in workspace_roles for role in user_roles):
					return False

			return True
		else:
			# Private workspace - only owner or Workspace Manager can access
			return workspace.for_user == frappe.session.user or frappe.has_role("Workspace Manager")

	except frappe.PermissionError:
		return False


def has_permission_for_workspace_link(link):
	"""Check permission for Workspace Link (from Workspace DocType)"""
	link_type = link.link_type or "DocType"
	link_to = link.link_to

	if not link_to:
		return False

	return _check_link_permission(link_type, link_to)


def has_permission_for_sidebar_link(link):
	"""Check permission for Workspace User Sidebar Link"""
	return _check_link_permission(link.link_type, link.link_to)


def has_permission_for_link_dict(link_dict):
	"""Check permission for dictionary-style link"""
	return _check_link_permission(link_dict.get("link_type"), link_dict.get("link_to"))


def _check_link_permission(link_type, link_to):
	"""
	Core permission checking logic for any link type.
	Returns True if accessible, False if not.
	"""
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

		elif link_type == "URL":
			# Custom URLs don't have permission checks
			return True

		else:
			# Unknown link type - deny by default
			return False

	except Exception as e:
		# Log error but don't expose to user
		frappe.log_error(f"Permission check failed for {link_type}: {link_to}", "Sidebar Permission Error")
		return False
