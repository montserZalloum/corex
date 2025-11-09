import EditorJS from "@editorjs/editorjs";
import Undo from "editorjs-undo";

// Global Deep Link Handler - Initialize before workspace constructor
// This ensures deep links work even on page refresh
frappe.provide("frappe.workspace_deep_link");

frappe.workspace_deep_link = {
	workspace_instance: null,

	init() {
		console.log("[Deep Link Global] Initializing global deep link handler");

		// Wait for frappe app to be ready
		// Use jQuery document ready and check for frappe.router
		$(document).ready(() => {
			console.log("[Deep Link Global] Document ready");

			// Check if router is available
			if (frappe.router) {
				console.log("[Deep Link Global] Router available, setting up hooks");
				this.setup_router_hooks();
			} else {
				// Wait for frappe.app to be ready
				console.log("[Deep Link Global] Waiting for frappe.app");
				const checkRouter = setInterval(() => {
					if (frappe.router) {
						console.log("[Deep Link Global] Router now available, setting up hooks");
						clearInterval(checkRouter);
						this.setup_router_hooks();
					}
				}, 100);
			}
		});
	},

	setup_router_hooks() {
		const self = this;

		// Wrap router.render to intercept deep links
		if (!frappe.router._deep_link_render_wrapped) {
			console.log("[Deep Link Global] Wrapping router.render for deep link detection");
			frappe.router._deep_link_render_wrapped = true;
			const original_render = frappe.router.render;

			frappe.router.render = function(...args) {
				console.log("[Deep Link Global] Render called, route:", frappe.router.current_route);
				console.log("[Deep Link Global] Render called, route:", frappe.router.current_route);

				// Check if workspace instance exists and is ready
				if (frappe.workspace && frappe.workspace.all_pages && frappe.workspace.all_pages.length > 0) {
					// Workspace is loaded, use instance method
					frappe.workspace.handle_deep_link_on_route_change().then((handled) => {
						console.log("[Deep Link Global] Handled by workspace instance:", handled);
						original_render.apply(frappe.router, args);
					});
					return;
				}

				// Workspace not loaded yet - check if this is a deep link we should handle
				const route = frappe.router.current_route;
				if (route && route.length > 0) {
					const first_part = route[0];
					const doctype_views = ["Form", "List", "Report", "Tree", "Kanban", "Calendar", "Gantt", "Dashboard", "Image", "Inbox", "Map"];

					if (doctype_views.includes(first_part)) {
						const doctype = route[1];
						console.log(`[Deep Link Global] Detected deep link on page load: ${first_part} for ${doctype}`);
						console.log("[Deep Link Global] Workspace not loaded yet, will handle after workspace loads");

						// Store the deep link to handle after workspace loads
						frappe.workspace_deep_link.pending_deep_link = { route, doctype, view: first_part };

						// DON'T render the page in main view - instead navigate to a workspace
						// This will trigger workspace initialization, which will then handle the pending deep link
						console.log("[Deep Link Global] Redirecting to a workspace to initialize system");

						// Navigate to first available workspace
						// This will create the workspace instance
						setTimeout(() => {
							// Try to find a workspace to navigate to
							if (frappe.workspaces && Object.keys(frappe.workspaces).length > 0) {
								const first_workspace = Object.values(frappe.workspaces)[0];
								console.log("[Deep Link Global] Navigating to workspace:", first_workspace.title);
								frappe.set_route("Workspaces", first_workspace.title);
							} else {
								// Fallback: try "Home" or any common workspace
								console.log("[Deep Link Global] Navigating to Home workspace");
								frappe.set_route("Workspaces", "Home");
							}
						}, 100);

						// Skip the default render
						return;
					}
				}

				// Call original render
				return original_render.apply(frappe.router, args);
			};
		}
	}
};

// Initialize immediately
frappe.workspace_deep_link.init();

frappe.standard_pages["Workspaces"] = function () {
	var wrapper = frappe.container.add_page("Workspaces");

	frappe.ui.make_app_page({
		parent: wrapper,
		name: "Workspaces",
		title: __("Workspace"),
	});

	frappe.workspace = new frappe.views.Workspace(wrapper);
	$(wrapper).bind("show", function () {
		frappe.workspace.show();
	});
};

frappe.views.Workspace = class Workspace {
	constructor(wrapper) {
		console.log("[Deep Link] Workspace constructor called");

		this.wrapper = $(wrapper);
		this.page = wrapper.page;
		this.blocks = frappe.workspace_block.blocks;
		this.is_read_only = true;
		this.pages = {};
		this.sorted_public_items = [];
		this.sorted_private_items = [];
		this.current_page = {};
		this.sidebar_items = {
			public: {},
			private: {},
		};
		this.sidebar_categories = [
			{ id: "Personal", label: __("Personal", null, "Workspace Category") },
			{ id: "Public", label: __("Public", null, "Workspace Category") },
		];
		this.indicator_colors = [
			"green",
			"cyan",
			"blue",
			"orange",
			"yellow",
			"gray",
			"grey",
			"red",
			"pink",
			"darkgrey",
			"purple",
			"light-blue",
		];
		this.active_workspace_window = null; // Track which window is active for routing
		this.window_z_index = 1000; // Track z-index for stacking windows

		this.prepare_container();
		this.setup_pages();
		this.register_awesomebar_shortcut();

		// Setup global deep link routing hook
		this.setup_deep_link_routing();
	}

	prepare_container() {
		let list_sidebar = $(`
			<div class="list-sidebar overlay-sidebar hidden-xs hidden-sm">
				<div class="desk-sidebar list-unstyled sidebar-menu"></div>
			</div>
		`).appendTo(this.wrapper.find(".layout-side-section"));
		this.sidebar = list_sidebar.find(".desk-sidebar");
		this.body = this.wrapper.find(".layout-main-section");
		this.prepare_new_and_edit();
	}

	async setup_pages(reload) {
		!this.discard && this.create_page_skeleton();
		!this.discard && this.create_sidebar_skeleton();
		this.sidebar_pages = !this.discard ? await this.get_pages() : this.sidebar_pages;
		this.cached_pages = $.extend(true, {}, this.sidebar_pages);
		this.all_pages = this.sidebar_pages.pages;
		this.has_access = this.sidebar_pages.has_access;
		this.has_create_access = this.sidebar_pages.has_create_access;

		this.all_pages.forEach((page) => {
			page.is_editable = !page.public || this.has_access;
		});

		this.public_pages = this.all_pages.filter((page) => page.public);
		this.private_pages = this.all_pages.filter((page) => !page.public);

		if (this.all_pages) {
			frappe.workspaces = {};
			for (let page of this.all_pages) {
				frappe.workspaces[frappe.router.slug(page.name)] = {
					title: page.title,
					public: page.public,
				};
			}
			this.make_sidebar();

			// Build doctype-to-workspace mapping for deep link handling
			this.build_doctype_workspace_map();

			// Check if we need to handle a deep link that's already in the URL
			console.log("[Deep Link] Pages loaded, checking for initial deep link");
			console.log("[Deep Link] Current route:", frappe.router.current_route);

			// Check if there's a pending deep link from page load
			if (frappe.workspace_deep_link && frappe.workspace_deep_link.pending_deep_link) {
				console.log("[Deep Link] Found pending deep link from page load:", frappe.workspace_deep_link.pending_deep_link);
				const pending = frappe.workspace_deep_link.pending_deep_link;

				// Handle the pending deep link
				this.handle_pending_deep_link(pending);

				// Clear the pending deep link
				frappe.workspace_deep_link.pending_deep_link = null;
			} else {
				this.handle_deep_link_on_route_change();
			}

			reload && this.show();
		}
	}

	prepare_new_and_edit() {
		this.$page = $(`
		<div class="editor-js-container"></div>
		<div class="workspace-footer">
			<button data-label="New" class="btn btn-default ellipsis btn-new-workspace">
				<svg class="es-icon es-line icon-xs" style="" aria-hidden="true">
					<use class="" href="#es-line-add"></use>
				</svg>
				<span class="hidden-xs" data-label="New">${__("New")}</span>
			</button>
			<button class="btn btn-default btn-sm mr-2 btn-edit-workspace" data-label="Edit">
				<svg class="es-icon es-line  icon-xs" style="" aria-hidden="true">
					<use class="" href="#es-line-edit"></use>
				</svg>
				<span class="hidden-xs" data-label="Edit">${__("Edit")}</span>
			</button>
		</div>
	`).appendTo(this.body);

		this.body.find(".btn-new-workspace").on("click", () => {
			this.initialize_new_page(true);
		});

		this.body.find(".btn-edit-workspace").on("click", async () => {
			if (!this.editor || !this.editor.readOnly) return;
			this.is_read_only = false;
			this.toggle_hidden_workspaces(true);
			await this.editor.readOnly.toggle();
			this.editor.isReady.then(() => {
				this.body.addClass("edit-mode");
				this.initialize_editorjs_undo();
				this.setup_customization_buttons(this._page);
				this.show_sidebar_actions();
				this.make_blocks_sortable();
			});
		});
	}

	get_pages() {
		return frappe.xcall("frappe.desk.desktop.get_workspace_sidebar_items");
	}

	sidebar_item_container(item) {
		item.indicator_color =
			item.indicator_color || this.indicator_colors[Math.floor(Math.random() * 12)];

		return $(`
			<div
				class="sidebar-item-container ${item.is_editable ? "is-draggable" : ""}"
				item-parent="${item.parent_page}"
				item-name="${item.title}"
				item-public="${item.public || 0}"
				item-is-hidden="${item.is_hidden || 0}"
			>
				<div class="desk-sidebar-item standard-sidebar-item ${item.selected ? "selected" : ""}">
					<a
						href="/app/${
							item.public
								? frappe.router.slug(item.title)
								: "private/" + frappe.router.slug(item.title)
						}"
						class="item-anchor ${item.is_editable ? "" : "block-click"}" title="${__(item.title)}"
					>
						<span class="sidebar-item-icon" item-icon=${item.icon || "folder-normal"}>
							${
								item.public
									? frappe.utils.icon(item.icon || "folder-normal", "md")
									: `<span class="indicator ${item.indicator_color}"></span>`
							}
						</span>
						<span class="sidebar-item-label">${__(item.title)}<span>
					</a>
					<div class="sidebar-item-control"></div>
				</div>
				<div class="sidebar-child-item nested-container"></div>
			</div>
		`);
	}

	make_sidebar() {
		if (this.sidebar.find(".standard-sidebar-section")[0]) {
			this.sidebar.find(".standard-sidebar-section").remove();
		}

		this.sidebar_categories.forEach((category) => {
			let root_pages = this.public_pages.filter(
				(page) => page.parent_page == "" || page.parent_page == null
			);
			if (category.id != "Public") {
				root_pages = this.private_pages.filter(
					(page) => page.parent_page == "" || page.parent_page == null
				);
			}
			root_pages = root_pages.uniqBy((d) => d.title);
			this.build_sidebar_section(category, root_pages);
		});

		// Scroll sidebar to selected page if it is not in viewport.
		this.sidebar.find(".selected").length &&
			!frappe.dom.is_element_in_viewport(this.sidebar.find(".selected")) &&
			this.sidebar.find(".selected")[0].scrollIntoView();

		this.remove_sidebar_skeleton();
	}

	build_sidebar_section(category, root_pages) {
		let sidebar_section = $(
			`<div class="standard-sidebar-section nested-container" data-title="${category.id}"></div>`
		);

		let $title = $(`<div class="cx-standard-sidebar-label-toggle grid-full-row"><button class="btn-reset standard-sidebar-label">
			<span>${frappe.utils.icon("es-line-down", "xs")}</span>
			<span class="section-title">${category.label}<span>
		</div></div>`).appendTo(sidebar_section);
		$title.attr({
			"aria-label": __("Toggle Section: {0}", [category.label]),
			"aria-expanded": "true",
		});
		this.prepare_sidebar(root_pages, sidebar_section, this.sidebar);

		$title.on("click", (e) => {
			const $e = $(e.target);
			const href = $e.find("span use").attr("href");
			const isCollapsed = href === "#es-line-down";
			let icon = isCollapsed ? "#es-line-right-chevron" : "#es-line-down";
			$e.find("span use").attr("href", icon);
			$e.parent().find(".sidebar-item-container").toggleClass("hidden");
			$e.attr("aria-expanded", String(!isCollapsed));
		});

		if (Object.keys(root_pages).length === 0) {
			sidebar_section.addClass("hidden");
		}

		$(".item-anchor").on("click", (e) => {
			e.preventDefault();
			// Close sidebar
			$(".list-sidebar.hidden-xs.hidden-sm").removeClass("opened");
			$(".close-sidebar").css("display", "none");
			$("body").css("overflow", "auto");

			// Open workspace in a window instead of navigating
			const $anchor = $(e.currentTarget);
			const page_title = $anchor.attr("title");
			const is_public = $anchor.closest(".sidebar-item-container").attr("item-public") === "1";

			this.open_workspace_window({ name: page_title, public: is_public });
		});

		if (
			sidebar_section.find(".sidebar-item-container").length &&
			sidebar_section.find("> [item-is-hidden='0']").length == 0
		) {
			sidebar_section.addClass("hidden show-in-edit-mode");
		}
	}

	prepare_sidebar(items, child_container, item_container) {
		items.forEach((item) => this.append_item(item, child_container));
		child_container.appendTo(item_container);
	}

	append_item(item, container) {
		let is_current_page =
			frappe.router.slug(item.title) == frappe.router.slug(this.get_page_to_show().name) &&
			item.public == this.get_page_to_show().public;
		item.selected = is_current_page;
		if (is_current_page) {
			this.current_page = { name: item.title, public: item.public };
		}

		let $item_container = this.sidebar_item_container(item);
		let sidebar_control = $item_container.find(".sidebar-item-control");

		this.add_sidebar_actions(item, sidebar_control);
		let pages = item.public ? this.public_pages : this.private_pages;

		let child_items = pages.filter((page) => page.parent_page == item.title);
		if (child_items.length > 0) {
			let child_container = $item_container.find(".sidebar-child-item");
			child_container.addClass("hidden");
			this.prepare_sidebar(child_items, child_container, $item_container);
		}

		$item_container.appendTo(container);
		this.sidebar_items[item.public ? "public" : "private"][item.title] = $item_container;

		if ($item_container.parent().hasClass("hidden") && is_current_page) {
			$item_container.parent().toggleClass("hidden");
		}

		this.add_drop_icon(item, sidebar_control, $item_container);

		if (child_items.length > 0) {
			$item_container.find(".drop-icon").first().addClass("show-in-edit-mode");
		}
	}

	add_drop_icon(item, sidebar_control, item_container) {
		let drop_icon = "es-line-down";
		if (item_container.find(`[item-name="${this.current_page.name}"]`).length) {
			drop_icon = "small-up";
		}

		let $child_item_section = item_container.find(".sidebar-child-item");
		let $drop_icon = $(`<button class="btn-reset drop-icon hidden">`)
			.html(frappe.utils.icon(drop_icon, "sm"))
			.appendTo(sidebar_control);
		let pages = item.public ? this.public_pages : this.private_pages;
		if (
			pages.some(
				(e) => e.parent_page == item.title && (e.is_hidden == 0 || !this.is_read_only)
			)
		) {
			$drop_icon.removeClass("hidden");
		}
		$drop_icon.on("click", () => {
			let icon =
				$drop_icon.find("use").attr("href") === "#es-line-down"
					? "#es-line-up"
					: "#es-line-down";
			$drop_icon.find("use").attr("href", icon);
			$child_item_section.toggleClass("hidden");
		});
	}

	show() {
		if (!this.all_pages) {
			// pages not yet loaded, call again after a bit
			setTimeout(() => this.show(), 100);
			return;
		}

		let page = this.get_page_to_show();

		if (!frappe.router.current_route[0]) {
			frappe.route_flags.replace_route = true;
			frappe.set_route(frappe.router.slug(page.public ? page.name : "private/" + page.name));
			return;
		}

		// Handle deep links - check if current route is a doctype route (not a workspace route)
		if (this.handle_deep_link()) {
			// Deep link was handled, don't show workspace page
			return;
		}

		this.page.set_title(__(page.name));
		this.update_selected_sidebar(this.current_page, false); //remove selected from old page
		this.update_selected_sidebar(page, true); //add selected on new page
		this.show_page(page);
	}

	update_selected_sidebar(page, add) {
		let section = page.public ? "public" : "private";
		if (
			this.sidebar &&
			this.sidebar_items[section] &&
			this.sidebar_items[section][page.name]
		) {
			let $sidebar = this.sidebar_items[section][page.name];
			let pages = page.public ? this.public_pages : this.private_pages;
			let sidebar_page = pages.find((p) => p.title == page.name);

			if (add) {
				$sidebar[0].firstElementChild.classList.add("selected");
				if (sidebar_page) sidebar_page.selected = true;

				// open child sidebar section if closed
				$sidebar.parent().hasClass("sidebar-child-item") &&
					$sidebar.parent().hasClass("hidden") &&
					$sidebar.parent().removeClass("hidden");

				this.current_page = { name: page.name, public: page.public };
				localStorage.current_page = page.name;
				localStorage.is_current_page_public = page.public;
			} else {
				$sidebar[0].firstElementChild.classList.remove("selected");
				if (sidebar_page) sidebar_page.selected = false;
			}
		}
	}

	get_data(page) {
		return frappe
			.call("frappe.desk.desktop.get_desktop_page", {
				page: page,
			})
			.then((data) => {
				this.page_data = data.message;

				// caching page data
				this.pages[page.name] && delete this.pages[page.name];
				this.pages[page.name] = data.message;

				if (!this.page_data || Object.keys(this.page_data).length === 0) return;
				if (this.page_data.charts && this.page_data.charts.items.length === 0) return;

				return frappe.dashboard_utils.get_dashboard_settings().then((settings) => {
					if (settings) {
						let chart_config = settings.chart_config
							? JSON.parse(settings.chart_config)
							: {};
						this.page_data.charts.items.map((chart) => {
							chart.chart_settings = chart_config[chart.chart_name] || {};
						});
						this.pages[page.name] = this.page_data;
					}
				});
			});
	}

	get_page_to_show() {
		let default_page;

		if (frappe.boot.user.default_workspace) {
			default_page = {
				name: frappe.boot.user.default_workspace.title,
				public: frappe.boot.user.default_workspace.public,
			};
		} else if (
			localStorage.current_page &&
			this.all_pages.filter((page) => page.title == localStorage.current_page).length != 0
		) {
			default_page = {
				name: localStorage.current_page,
				public: localStorage.is_current_page_public != "false",
			};
		} else if (Object.keys(this.all_pages).length !== 0) {
			default_page = { name: this.all_pages[0].title, public: this.all_pages[0].public };
		} else {
			default_page = { name: "Build", public: true };
		}

		const route = frappe.get_route();
		const page = (route[1] == "private" ? route[2] : route[1]) || default_page.name;
		const is_public = route[1] ? route[1] != "private" : default_page.public;
		return { name: page, public: is_public };
	}

	async show_page(page) {
		// Desktop mode: Don't render page content, just setup for window system
		// Users will click workspace icons to open windows instead
		this.remove_page_skeleton();
		this.setup_actions(page);
		return;
	}

	add_custom_cards_in_content() {
		let index = -1;
		this.content.find((item, i) => {
			if (item.type == "card") index = i;
		});
		if (index !== -1) {
			this.content.splice(index + 1, 0, {
				type: "card",
				data: { card_name: "Custom Documents", col: 4 },
			});
			this.content.splice(index + 2, 0, {
				type: "card",
				data: { card_name: "Custom Reports", col: 4 },
			});
		}
	}

	prepare_editorjs() {
		if (this.editor) {
			this.editor.isReady.then(() => {
				this.editor.configuration.tools.chart.config.page_data = this.page_data;
				this.editor.configuration.tools.shortcut.config.page_data = this.page_data;
				this.editor.configuration.tools.card.config.page_data = this.page_data;
				this.editor.configuration.tools.onboarding.config.page_data = this.page_data;
				this.editor.configuration.tools.quick_list.config.page_data = this.page_data;
				this.editor.configuration.tools.number_card.config.page_data = this.page_data;
				this.editor.configuration.tools.custom_block.config.page_data = this.page_data;
				this.editor.render({ blocks: this.content || [] });
			});
		} else {
			this.initialize_editorjs(this.content);
		}
	}

	setup_actions(page) {
		let pages = page.public ? this.public_pages : this.private_pages;
		let current_page = pages.filter((p) => p.title == page.name)[0];

		if (!this.is_read_only) {
			this.setup_customization_buttons(current_page);
			return;
		}

		this.clear_page_actions();
		if (current_page.is_editable) {
			this.body.find(".btn-edit-workspace").removeClass("hide");
		} else {
			this.body.find(".btn-edit-workspace").addClass("hide");
		}

		// need to add option for icons in inner buttons as well
		if (this.has_create_access) {
			this.body.find(".btn-new-workspace").removeClass("hide");
		} else {
			this.body.find(".btn-new-workspace").addClass("hide");
		}
	}

	initialize_editorjs_undo() {
		this.undo = new Undo({ editor: this.editor });
		this.undo.initialize({ blocks: this.content || [] });
		this.undo.readOnly = false;
	}

	clear_page_actions() {
		this.page.clear_primary_action();
		this.page.clear_secondary_action();
		this.page.clear_inner_toolbar();
	}

	setup_customization_buttons(page) {
		this.clear_page_actions();

		page.is_editable &&
			this.page.set_primary_action(
				__("Save"),
				() => {
					this.clear_page_actions();
					this.body.removeClass("edit-mode");
					this.save_page(page).then((saved) => {
						if (!saved) return;
						this.undo.readOnly = true;
						this.editor.readOnly.toggle();
						this.is_read_only = true;
					});
				},
				null,
				__("Saving")
			);

		this.page.set_secondary_action(__("Discard"), async () => {
			this.body.removeClass("edit-mode");
			this.discard = true;
			this.clear_page_actions();
			this.toggle_hidden_workspaces(false);
			await this.editor.readOnly.toggle();
			this.is_read_only = true;
			this.sidebar_pages = this.cached_pages;
			this.reload();
			frappe.show_alert({ message: __("Customizations Discarded"), indicator: "info" });
		});

		if (page.name && this.has_access) {
			this.page.add_inner_button(__("Settings"), () => {
				frappe.set_route(`workspace/${page.name}`);
			});
		}
	}

	toggle_hidden_workspaces(show) {
		$(".desk-sidebar").toggleClass("show-hidden-workspaces", show);
	}

	show_sidebar_actions() {
		this.sidebar.find(".standard-sidebar-section").addClass("show-control");
		this.make_sidebar_sortable();
	}

	add_sidebar_actions(item, sidebar_control, is_new) {
		if (!item.is_editable) {
			sidebar_control.parent().click(() => {
				!this.is_read_only &&
					frappe.show_alert(
						{
							message: __("Only Workspace Manager can sort or edit this page"),
							indicator: "info",
						},
						5
					);
			});

			frappe.utils.add_custom_button(
				frappe.utils.icon("es-line-duplicate", "sm"),
				() => this.duplicate_page(item),
				"duplicate-page",
				__("Duplicate Workspace"),
				null,
				sidebar_control
			);
		} else if (item.is_hidden) {
			frappe.utils.add_custom_button(
				frappe.utils.icon("es-line-preview", "sm"),
				(e) => this.unhide_workspace(item, e),
				"unhide-workspace-btn",
				__("Unhide Workspace"),
				null,
				sidebar_control
			);
		} else {
			frappe.utils.add_custom_button(
				frappe.utils.icon("es-line-drag", "xs"),
				null,
				"drag-handle",
				__("Drag"),
				null,
				sidebar_control
			);

			!is_new && this.add_settings_button(item, sidebar_control);
		}
	}

	get_parent_pages(page) {
		this.public_parent_pages = [
			"",
			...this.public_pages.filter((p) => !p.parent_page).map((p) => p.title),
		];
		this.private_parent_pages = [
			"",
			...this.private_pages.filter((p) => !p.parent_page).map((p) => p.title),
		];

		if (page) {
			return page.public ? this.public_parent_pages : this.private_parent_pages;
		}
	}

	edit_page(item) {
		var me = this;
		let old_item = item;
		let parent_pages = this.get_parent_pages(item);
		let idx = parent_pages.findIndex((x) => x == item.title);
		if (idx !== -1) parent_pages.splice(idx, 1);
		const d = new frappe.ui.Dialog({
			title: __("Update Details"),
			fields: [
				{
					label: __("Title"),
					fieldtype: "Data",
					fieldname: "title",
					reqd: 1,
					default: item.title,
				},
				{
					label: __("Parent"),
					fieldtype: "Select",
					fieldname: "parent",
					options: parent_pages,
					default: item.parent_page,
				},
				{
					label: __("Public"),
					fieldtype: "Check",
					fieldname: "is_public",
					depends_on: `eval:${this.has_access}`,
					default: item.public,
					onchange: function () {
						d.set_df_property(
							"parent",
							"options",
							this.get_value() ? me.public_parent_pages : me.private_parent_pages
						);
						d.set_df_property("icon", "hidden", this.get_value() ? 0 : 1);
						d.set_df_property("indicator_color", "hidden", this.get_value() ? 1 : 0);
					},
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("Icon"),
					fieldtype: "Icon",
					fieldname: "icon",
					default: item.public && item.icon,
					hidden: !item.public,
				},
				{
					label: __("Indicator color"),
					fieldtype: "Select",
					fieldname: "indicator_color",
					options: this.indicator_colors,
					default: !item.public && item.indicator_color,
					hidden: item.public,
				},
			],
			primary_action_label: __("Update"),
			primary_action: (values) => {
				values.title = strip_html(values.title);
				let is_title_changed = values.title != old_item.title;
				let is_section_changed = Boolean(values.is_public) != Boolean(old_item.public);
				if (
					(is_title_changed || is_section_changed) &&
					!this.validate_page(values, old_item)
				)
					return;
				d.hide();

				frappe.call({
					method: "frappe.desk.doctype.workspace.workspace.update_page",
					args: {
						name: old_item.name,
						title: values.title,
						icon: values.icon || "",
						indicator_color: values.indicator_color || "",
						parent: values.parent || "",
						public: values.is_public || 0,
					},
					callback: function (res) {
						if (res.message) {
							let message = __("Workspace {0} Edited Successfully", [
								old_item.title.bold(),
							]);
							frappe.show_alert({ message: message, indicator: "green" });
						}
					},
				});

				this.update_sidebar(old_item, values);

				if (this.make_page_selected) {
					let pre_url = values.is_public ? "" : "private/";
					let route = pre_url + frappe.router.slug(values.title);
					frappe.set_route(route);

					this.make_page_selected = false;
				}

				this.make_sidebar();
				this.show_sidebar_actions();
			},
		});
		d.show();
	}

	update_sidebar(old_item, new_item) {
		let is_section_changed = old_item.public != (new_item.is_public || 0);
		let is_title_changed = old_item.title != new_item.title;
		let new_updated_item = { ...old_item };

		let pages = old_item.public ? this.public_pages : this.private_pages;

		let child_items = pages.filter((page) => page.parent_page == old_item.title);

		this.make_page_selected = old_item.selected;

		new_updated_item.title = new_item.title;
		new_updated_item.icon = new_item.icon;
		new_updated_item.indicator_color = new_item.indicator_color;
		new_updated_item.parent_page = new_item.parent || "";
		new_updated_item.public = new_item.is_public;

		if (is_title_changed || is_section_changed) {
			if (new_item.is_public) {
				new_updated_item.name = new_item.title;
				new_updated_item.label = new_item.title;
				new_updated_item.for_user = "";
			} else {
				let user = frappe.session.user;
				new_updated_item.name = `${new_item.title}-${user}`;
				new_updated_item.label = `${new_item.title}-${user}`;
				new_updated_item.for_user = user;
			}
		}
		this.update_cached_values(old_item, new_updated_item);

		if (child_items.length) {
			child_items.forEach((child) => {
				child.parent_page = new_item.title;
				is_section_changed && this.update_child_sidebar(child, new_item);
			});
		}
	}

	update_child_sidebar(child, new_item) {
		let old_child = { ...child };
		this.make_page_selected = child.selected;

		child.public = new_item.is_public;
		if (new_item.is_public) {
			child.name = child.title;
			child.label = child.title;
			child.for_user = "";
		} else {
			let user = frappe.session.user;
			child.name = `${child.title}-${user}`;
			child.label = `${child.title}-${user}`;
			child.for_user = user;
		}

		this.update_cached_values(old_child, child);
	}

	update_cached_values(old_item, new_item, duplicate, new_page) {
		let [from_pages, to_pages] = old_item.public
			? [this.public_pages, this.private_pages]
			: [this.private_pages, this.public_pages];

		let old_item_index = from_pages.findIndex((page) => page.title == old_item.title);
		duplicate && old_item_index++;

		// update frappe.workspaces
		if (frappe.workspaces[frappe.router.slug(old_item.name)] || new_page) {
			!duplicate && delete frappe.workspaces[frappe.router.slug(old_item.name)];
			if (new_item) {
				frappe.workspaces[frappe.router.slug(new_item.name)] = { title: new_item.title };
			}
		}

		// update page block data
		if ((this.pages && this.pages[old_item.name]) || new_page) {
			if (new_item) {
				this.pages[new_item.name] = this.pages[old_item.name] || {};
			}
			!duplicate && delete this.pages[old_item.name];
		}

		// update public and private pages
		if (new_item) {
			let is_section_changed =
				old_item.public != (new_item.is_public || new_item.public || 0);

			if (is_section_changed) {
				!duplicate && from_pages.splice(old_item_index, 1);
				to_pages.push(new_item);
			} else if (new_page) {
				from_pages.push(new_item);
			} else {
				from_pages.splice(old_item_index, duplicate ? 0 : 1, new_item);
			}
		} else {
			from_pages.splice(old_item_index, 1);
		}

		this.sidebar_pages.pages = [...this.public_pages, ...this.private_pages];
		this.cached_pages = this.sidebar_pages;
	}

	add_settings_button(item, sidebar_control) {
		this.dropdown_list = [
			{
				label: __("Edit"),
				title: __("Edit Workspace"),
				icon: frappe.utils.icon("es-line-edit", "sm"),
				action: () => this.edit_page(item),
			},
			{
				label: __("Duplicate"),
				title: __("Duplicate Workspace"),
				icon: frappe.utils.icon("es-line-duplicate", "sm"),
				action: () => this.duplicate_page(item),
			},
			{
				label: __("Hide"),
				title: __("Hide Workspace"),
				icon: frappe.utils.icon("es-line-hide", "sm"),
				action: (e) => this.hide_workspace(item, e),
			},
		];

		if (this.is_item_deletable(item)) {
			this.dropdown_list.push({
				label: __("Delete"),
				title: __("Delete Workspace"),
				icon: frappe.utils.icon("delete-active", "sm"),
				action: () => this.delete_page(item),
			});
		}

		let $button = $(`
			<div class="btn btn-xs setting-btn dropdown-btn" title="${__("Setting")}">
				${frappe.utils.icon("es-line-dot-horizontal", "xs")}
			</div>
			<div class="dropdown-list hidden"></div>
		`);

		let dropdown_item = function (label, title, icon, action) {
			let html = $(`
				<div class="dropdown-item" title="${title}">
					<span class="dropdown-item-icon">${icon}</span>
					<span class="dropdown-item-label">${label}</span>
				</div>
			`);

			html.click((event) => {
				event.stopPropagation();
				action && action(event);
			});

			return html;
		};

		$button.filter(".dropdown-btn").click((event) => {
			event.stopPropagation();
			if ($button.filter(".dropdown-list.hidden").length) {
				$(".dropdown-list:not(.hidden)").addClass("hidden");
			}
			$button.filter(".dropdown-list").toggleClass("hidden");
		});

		sidebar_control.append($button);

		this.dropdown_list.forEach((i) => {
			$button
				.filter(".dropdown-list")
				.append(dropdown_item(i.label, i.title, i.icon, i.action));
		});
	}

	is_item_deletable(item) {
		// if item is private
		// if item is public but doesn't have module set
		// if item is public and has module set but developer mode is on
		// then item is deletable
		if (
			!item.public ||
			(item.public && (!item.module || (item.module && frappe.boot.developer_mode)))
		)
			return true;
		return false;
	}

	delete_page(page) {
		frappe.confirm(
			__("Are you sure you want to delete page {0}?", [page.title.bold()]),
			() => {
				frappe.call({
					method: "frappe.desk.doctype.workspace.workspace.delete_page",
					args: { page: page },
					callback: function (res) {
						if (res.message) {
							let page = res.message;
							let message = __("Workspace {0} Deleted Successfully", [
								page.title.bold(),
							]);
							frappe.show_alert({ message: message, indicator: "green" });
						}
					},
				});

				this.page.clear_primary_action();
				this.update_cached_values(page);

				if (
					this.current_page.name == page.title &&
					this.current_page.public == page.public
				) {
					frappe.set_route("/");
				}

				this.make_sidebar();
				this.show_sidebar_actions();
			}
		);
	}

	duplicate_page(page) {
		var me = this;
		let new_page = { ...page };
		if (!this.has_access && new_page.public) {
			new_page.public = 0;
		}
		let parent_pages = this.get_parent_pages({ public: new_page.public });
		const d = new frappe.ui.Dialog({
			title: __("Create Duplicate"),
			fields: [
				{
					label: __("Title"),
					fieldtype: "Data",
					fieldname: "title",
					reqd: 1,
				},
				{
					label: __("Parent"),
					fieldtype: "Select",
					fieldname: "parent",
					options: parent_pages,
					default: new_page.parent_page,
				},
				{
					label: __("Public"),
					fieldtype: "Check",
					fieldname: "is_public",
					depends_on: `eval:${this.has_access}`,
					default: new_page.public,
					onchange: function () {
						d.set_df_property(
							"parent",
							"options",
							this.get_value() ? me.public_parent_pages : me.private_parent_pages
						);
						d.set_df_property("icon", "hidden", this.get_value() ? 0 : 1);
						d.set_df_property("indicator_color", "hidden", this.get_value() ? 1 : 0);
					},
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("Icon"),
					fieldtype: "Icon",
					fieldname: "icon",
					default: new_page.public && new_page.icon,
					hidden: !new_page.public,
				},
				{
					label: __("Indicator color"),
					fieldtype: "Select",
					fieldname: "indicator_color",
					options: this.indicator_colors,
					hidden: new_page.public,
					default: !new_page.public && new_page.indicator_color,
				},
			],
			primary_action_label: __("Duplicate"),
			primary_action: (values) => {
				if (!this.validate_page(values)) return;
				d.hide();
				frappe.call({
					method: "frappe.desk.doctype.workspace.workspace.duplicate_page",
					args: {
						page_name: page.name,
						new_page: values,
					},
					callback: function (res) {
						if (res.message) {
							let new_page = res.message;
							let message = __(
								"Duplicate of {0} named as {1} is created successfully",
								[page.title.bold(), new_page.title.bold()]
							);
							frappe.show_alert({ message: message, indicator: "green" });
						}
					},
				});

				new_page.title = values.title;
				new_page.public = values.is_public || 0;
				new_page.name = values.title + (new_page.public ? "" : "-" + frappe.session.user);
				new_page.label = new_page.name;
				new_page.icon = values.icon;
				new_page.indicator_color = values.indicator_color;
				new_page.parent_page = values.parent || "";
				new_page.for_user = new_page.public ? "" : frappe.session.user;
				new_page.is_editable = !new_page.public;
				new_page.selected = true;

				this.update_cached_values(page, new_page, true);

				let pre_url = values.is_public ? "" : "private/";
				let route = pre_url + frappe.router.slug(values.title);
				frappe.set_route(route);

				me.make_sidebar();
				me.show_sidebar_actions();
			},
		});
		d.show();
	}

	hide_unhide_workspace(page, event, hide) {
		page.is_hidden = hide;

		let sidebar_control = event.target.closest(".sidebar-item-control");
		let sidebar_item_container = sidebar_control.closest(".sidebar-item-container");
		$(sidebar_item_container).attr("item-is-hidden", hide);

		$(sidebar_control).empty();
		this.add_sidebar_actions(page, $(sidebar_control));

		this.add_drop_icon(page, $(sidebar_control), $(sidebar_item_container));

		let cached_page = this.cached_pages.pages.findIndex((p) => p.name === page.name);
		if (cached_page !== -1) {
			this.cached_pages.pages[cached_page].is_hidden = hide;
		}

		let method = hide ? "hide_page" : "unhide_page";
		frappe.call({
			method: "frappe.desk.doctype.workspace.workspace." + method,
			args: {
				page_name: page.name,
			},
			callback: (r) => {
				if (!r.message) return;

				let message = hide ? "{0} is hidden successfully" : "{0} is unhidden successfully";
				message = __(message, [page.title.bold()]);
				frappe.show_alert({ message: message, indicator: "green" });
			},
		});
	}

	hide_workspace(page, event) {
		this.hide_unhide_workspace(page, event, 1);
	}

	unhide_workspace(page, event) {
		this.hide_unhide_workspace(page, event, 0);
	}

	make_sidebar_sortable() {
		let me = this;
		$(".nested-container").each(function () {
			new Sortable(this, {
				handle: ".drag-handle",
				draggable: ".sidebar-item-container.is-draggable",
				group: "nested",
				animation: 150,
				fallbackOnBody: true,
				swapThreshold: 0.65,
				onEnd: function (evt) {
					let is_public = $(evt.item).attr("item-public") == "1";
					me.prepare_sorted_sidebar(is_public);
					me.update_sorted_sidebar();
				},
			});
		});
	}

	prepare_sorted_sidebar(is_public) {
		let pages = is_public ? this.public_pages : this.private_pages;
		if (is_public) {
			this.sorted_public_items = this.sort_sidebar(
				this.sidebar.find(".standard-sidebar-section").last(),
				pages
			);
		} else {
			this.sorted_private_items = this.sort_sidebar(
				this.sidebar.find(".standard-sidebar-section").first(),
				pages
			);
		}

		this.sidebar_pages.pages = [...this.public_pages, ...this.private_pages];
		this.cached_pages = this.sidebar_pages;
	}

	sort_sidebar($sidebar_section, pages) {
		let sorted_items = [];
		Array.from($sidebar_section.find(".sidebar-item-container")).forEach((page, i) => {
			let parent_page = "";

			if (page.closest(".nested-container").classList.contains("sidebar-child-item")) {
				parent_page = page.parentElement.parentElement.attributes["item-name"].value;
			}

			sorted_items.push({
				title: page.attributes["item-name"].value,
				parent_page: parent_page,
				public: page.attributes["item-public"].value,
			});

			let $drop_icon = $(page).find(".sidebar-item-control .drop-icon").first();
			if ($(page).find(".sidebar-child-item > *").length != 0) {
				$drop_icon.removeClass("hidden");
			} else {
				$drop_icon.addClass("hidden");
			}

			let from_index = pages.findIndex((p) => p.title == page.attributes["item-name"].value);
			let element = pages[from_index];
			element.parent_page = parent_page;
			if (from_index != i) {
				pages.splice(from_index, 1);
				pages.splice(i, 0, element);
			}
		});
		return sorted_items;
	}

	update_sorted_sidebar() {
		if (this.sorted_public_items || this.sorted_private_items) {
			frappe.call({
				method: "frappe.desk.doctype.workspace.workspace.sort_pages",
				args: {
					sb_public_items: this.sorted_public_items,
					sb_private_items: this.sorted_private_items,
				},
				callback: function (res) {
					if (res.message) {
						let message = `Sidebar Updated Successfully`;
						frappe.show_alert({ message: __(message), indicator: "green" });
					}
				},
			});
		}
	}

	make_blocks_sortable() {
		let me = this;
		this.page_sortable = Sortable.create(
			this.page.main.find(".codex-editor__redactor").get(0),
			{
				handle: ".drag-handle",
				draggable: ".ce-block",
				animation: 150,
				onEnd: function (evt) {
					me.editor.blocks.move(evt.newIndex, evt.oldIndex);
				},
				setData: function () {
					//Do Nothing
				},
			}
		);
	}

	initialize_new_page() {
		var me = this;
		this.get_parent_pages();
		const d = new frappe.ui.Dialog({
			title: __("New Workspace"),
			fields: [
				{
					label: __("Title"),
					fieldtype: "Data",
					fieldname: "title",
					reqd: 1,
				},
				{
					label: __("Parent"),
					fieldtype: "Select",
					fieldname: "parent",
					options: this.private_parent_pages,
				},
				{
					label: __("Public"),
					fieldtype: "Check",
					fieldname: "is_public",
					depends_on: `eval:${this.has_access}`,
					onchange: function () {
						d.set_df_property(
							"parent",
							"options",
							this.get_value() ? me.public_parent_pages : me.private_parent_pages
						);
						d.set_df_property("icon", "hidden", this.get_value() ? 0 : 1);
						d.set_df_property("indicator_color", "hidden", this.get_value() ? 1 : 0);
					},
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("Icon"),
					fieldtype: "Icon",
					fieldname: "icon",
					hidden: 1,
				},
				{
					label: __("Indicator color"),
					fieldtype: "Select",
					fieldname: "indicator_color",
					options: this.indicator_colors,
				},
			],
			primary_action_label: __("Create"),
			primary_action: (values) => {
				values.title = strip_html(values.title);
				if (!this.validate_page(values)) return;
				d.hide();
				this.initialize_editorjs_undo();
				this.setup_customization_buttons({ is_editable: true });

				let name = values.title + (values.is_public ? "" : "-" + frappe.session.user);
				let blocks = [
					{
						type: "header",
						data: { text: values.title },
					},
				];

				let new_page = {
					content: JSON.stringify(blocks),
					name: name,
					label: name,
					title: values.title,
					public: values.is_public || 0,
					for_user: values.is_public ? "" : frappe.session.user,
					icon: values.icon,
					indicator_color: values.indicator_color,
					parent_page: values.parent || "",
					is_editable: true,
					selected: true,
				};

				this.editor
					.render({
						blocks: blocks,
					})
					.then(async () => {
						if (this.editor.configuration.readOnly) {
							this.is_read_only = false;
							await this.editor.readOnly.toggle();
						}

						frappe.call({
							method: "frappe.desk.doctype.workspace.workspace.new_page",
							args: {
								new_page: new_page,
							},
							callback: function (res) {
								if (res.message) {
									let message = __("Workspace {0} Created Successfully", [
										new_page.title.bold(),
									]);
									frappe.show_alert({
										message: message,
										indicator: "green",
									});
								}
							},
						});

						this.update_cached_values(new_page, new_page, true, true);

						let pre_url = new_page.public ? "" : "private/";
						let route = pre_url + frappe.router.slug(new_page.title);
						frappe.set_route(route);

						this.make_sidebar();
						this.show_sidebar_actions();
						localStorage.setItem("new_workspace", JSON.stringify(new_page));
					});
			},
		});
		d.show();
	}

	validate_page(new_page, old_page) {
		let message = "";
		let [from_pages, to_pages] = new_page.is_public
			? [this.private_pages, this.public_pages]
			: [this.public_pages, this.private_pages];

		let section = this.sidebar_categories[new_page.is_public];

		if (to_pages && to_pages.filter((p) => p.title == new_page.title)[0]) {
			message = __("Page with title {0} already exist.", [new_page.title.bold()]);
		}

		if (frappe.router.doctype_route_exist(frappe.router.slug(new_page.title))) {
			message = __("Doctype with same route already exist. Please choose different title.");
		}

		let child_pages = old_page && from_pages.filter((p) => p.parent_page == old_page.title);
		if (child_pages) {
			child_pages.every((child_page) => {
				if (to_pages && to_pages.find((p) => p.title == child_page.title)) {
					message = __(
						"One of the child page with name {0} already exist in {1} Section. Please update the name of the child page first before moving",
						[child_page.title.bold(), section.bold()]
					);
					cur_dialog.hide();
					return false;
				}
				return true;
			});
		}

		if (message) {
			frappe.throw(__(message));
			return false;
		}
		return true;
	}

	add_page_to_sidebar(page) {
		let $sidebar = $(".standard-sidebar-section");
		let item = { ...page };

		item.selected = true;
		item.is_editable = true;

		let $sidebar_item = this.sidebar_item_container(item);

		this.add_sidebar_actions(item, $sidebar_item.find(".sidebar-item-control"), true);

		$sidebar_item.find(".sidebar-item-control .drag-handle").css("margin-right", "8px");

		let sidebar_section = item.is_public ? $sidebar[1] : $sidebar[0];

		if (!item.parent) {
			!item.is_public && $sidebar.first().removeClass("hidden");
			$sidebar_item.appendTo(sidebar_section);
		} else {
			let $item_container = $(sidebar_section).find(`[item-name="${item.parent}"]`);
			let $child_section = $item_container.find(".sidebar-child-item");
			let $drop_icon = $item_container.find(".drop-icon");
			if (!$child_section[0]) {
				$child_section = $(
					`<div class="sidebar-child-item hidden nested-container"></div>`
				).appendTo($item_container);
				$drop_icon.toggleClass("hidden");
			}
			$sidebar_item.appendTo($child_section);
			$child_section.removeClass("hidden");
			$item_container.find(".drop-icon.hidden").removeClass("hidden");
			$item_container.find(".drop-icon use").attr("href", "#es-line-up");
		}

		let section = item.is_public ? "public" : "private";
		if (
			this.sidebar_items &&
			this.sidebar_items[section] &&
			!this.sidebar_items[section][item.title]
		) {
			this.sidebar_items[section][item.title] = $sidebar_item;
		}
	}

	initialize_editorjs(blocks) {
		this.tools = {
			header: {
				class: this.blocks["header"],
				inlineToolbar: ["HeaderSize", "bold", "italic", "link"],
				config: {
					default_size: 4,
				},
			},
			paragraph: {
				class: this.blocks["paragraph"],
				inlineToolbar: ["HeaderSize", "bold", "italic", "link"],
				config: {
					placeholder: __("Choose a block or continue typing"),
				},
			},
			chart: {
				class: this.blocks["chart"],
				config: {
					page_data: this.page_data || [],
				},
			},
			card: {
				class: this.blocks["card"],
				config: {
					page_data: this.page_data || [],
				},
			},
			shortcut: {
				class: this.blocks["shortcut"],
				config: {
					page_data: this.page_data || [],
				},
			},
			onboarding: {
				class: this.blocks["onboarding"],
				config: {
					page_data: this.page_data || [],
				},
			},
			quick_list: {
				class: this.blocks["quick_list"],
				config: {
					page_data: this.page_data || [],
				},
			},
			number_card: {
				class: this.blocks["number_card"],
				config: {
					page_data: this.page_data || [],
				},
			},
			custom_block: {
				class: this.blocks["custom_block"],
				config: {
					page_data: this.page_data || [],
				},
			},
			spacer: this.blocks["spacer"],
			HeaderSize: frappe.workspace_block.tunes["header_size"],
		};

		this.editor = new EditorJS({
			data: {
				blocks: blocks || [],
			},
			tools: this.tools,
			autofocus: false,
			readOnly: true,
			logLevel: "ERROR",
		});
	}

	open_workspace_window(page) {
		// Create a unique window ID for this workspace
		const window_id = `workspace-window-${frappe.router.slug(page.name)}-${Date.now()}`;

		// Increment z-index for new windows (always on top)
		this.window_z_index += 1;
		const current_z_index = this.window_z_index;

		// Create window container with inner content area
		const $window = $(`
			<div class="workspace-window" id="${window_id}" data-page-name="${page.name}" data-page-public="${page.public}" style="z-index: ${current_z_index};">
				<div class="window-titlebar">
					<div class="window-breadcrumb">
						<span class="window-title">${page.name}</span>
						<span class="breadcrumb-trail" style="display: none;"></span>
					</div>
					<div class="window-controls">
						<button class="btn-window-back" title="Back" style="display: none;">←</button>
						<button class="btn-window-minimize" title="Minimize">_</button>
						<button class="btn-window-maximize" title="Maximize">□</button>
						<button class="btn-window-close" title="Close">×</button>
					</div>
				</div>
				<div class="window-content">
					<div class="window-loader" style="text-align: center; padding: 20px;">
						<p>Loading ${page.name}...</p>
					</div>
				</div>
				<!-- Resize handles -->
				<div class="resize-handle resize-handle-top" data-direction="top"></div>
				<div class="resize-handle resize-handle-bottom" data-direction="bottom"></div>
				<div class="resize-handle resize-handle-left" data-direction="left"></div>
				<div class="resize-handle resize-handle-right" data-direction="right"></div>
				<div class="resize-handle resize-handle-top-left" data-direction="top-left"></div>
				<div class="resize-handle resize-handle-top-right" data-direction="top-right"></div>
				<div class="resize-handle resize-handle-bottom-left" data-direction="bottom-left"></div>
				<div class="resize-handle resize-handle-bottom-right" data-direction="bottom-right"></div>
			</div>
		`).appendTo(this.body);

		// Store window reference and z-index
		$window.data("workspace-instance", this);
		$window.data("workspace-page", page);
		$window.data("base-z-index", current_z_index);
		$window.attr("data-workspace-name", page.name); // For debugging

		// Initialize simple route history stack for this window
		$window.data("route-stack", []);
		
		// Set this as the active window when clicking inside content
		$window.find(".window-content").on("mousedown", (e) => {
			// Only set active if we're not dragging a window
			if (!$window.data("is-dragging")) {
				this.active_workspace_window = $window;
			}
		});
		

		// Make window draggable
		this.make_window_draggable($window);

		// Make window resizable
		this.make_window_resizable($window);

		// Add window control handlers with smooth transitions
		$window.find(".btn-window-close").on("click", () => {
			// Remove all pages created for this window
			this.cleanup_window_pages($window);
			$window.fadeOut(200, function() {
				$(this).remove();
			});
		});

		$window.find(".btn-window-minimize").on("click", () => {
			const $content = $window.find(".window-content");
			const isMinimized = $content.hasClass("minimized");

			if (isMinimized) {
				$content.slideDown(200).removeClass("minimized");
			} else {
				$content.slideUp(200).addClass("minimized");
			}
		});

		$window.find(".btn-window-maximize").on("click", () => {
			const isMaximized = $window.hasClass("maximized");

			if (isMaximized) {
				// Restore to previous size
				const savedPos = $window.data("saved-position");
				if (savedPos) {
					$window.css({
						left: savedPos.left + "px",
						top: savedPos.top + "px",
						width: savedPos.width + "px",
						height: savedPos.height + "px"
					});
				}
				$window.removeClass("maximized");
			} else {
				// Save current position and maximize
				$window.data("saved-position", {
					left: $window.position().left,
					top: $window.position().top,
					width: $window.width(),
					height: $window.height()
				});
				$window.addClass("maximized");
			}
		});

		$window.find(".btn-window-back").on("click", () => {
			this.show_workspace_content_in_window($window);
		});

		// Load workspace content
		this.load_workspace_content(page, $window);

		return $window;
	}

	make_window_draggable($window) {
		const dragState = {
			isDown: false,
			offset: [0, 0]
		};
		const $titlebar = $window.find(".window-titlebar");
		const self = this;

		$titlebar.on("mousedown", (e) => {
			// Don't drag if clicking on a button
			if ($(e.target).closest("button").length) return;

			dragState.isDown = true;
			$window.addClass("dragging");
			$window.data("is-dragging", true); // Flag to prevent routing during drag
			dragState.offset = [
				$window.offset().left - e.clientX,
				$window.offset().top - e.clientY
			];

			// Bring to front by incrementing z-index
			self.window_z_index += 1;
			$window.css("z-index", self.window_z_index);

			// Prevent any selection or default behavior during drag
			e.preventDefault();
		});

		const windowMoveHandler = (e) => {
			if (dragState.isDown) {
				const newLeft = e.clientX + dragState.offset[0];
				const newTop = e.clientY + dragState.offset[1];

				// Constrain to viewport with some margin
				const maxLeft = $(window).width() - $window.outerWidth() + 100;
				const maxTop = $(window).height() - $window.outerHeight() + 100;

				$window.css({
					left: Math.max(-100, Math.min(newLeft, maxLeft)) + "px",
					top: Math.max(0, Math.min(newTop, maxTop)) + "px"
				});
			}
		};

		const windowUpHandler = () => {
			if (dragState.isDown) {
				dragState.isDown = false;
				$window.removeClass("dragging");
				$window.data("is-dragging", false); // Clear drag flag
			}
		};

		// Use window level events, not document
		$(window).on("mousemove", windowMoveHandler);
		$(window).on("mouseup", windowUpHandler);

		// Store handlers on window for cleanup if needed
		$window.data("drag-handlers", { move: windowMoveHandler, up: windowUpHandler });
	}

	make_window_resizable($window) {
		const resizeState = {
			isResizing: false,
			direction: null,
			startX: 0,
			startY: 0,
			startWidth: 0,
			startHeight: 0,
			startLeft: 0,
			startTop: 0
		};

		const self = this;
		const MIN_WIDTH = 300;
		const MIN_HEIGHT = 200;

		const $handles = $window.find(".resize-handle");

		$handles.on("mousedown", (e) => {
			resizeState.isResizing = true;
			resizeState.direction = $(e.currentTarget).data("direction");
			resizeState.startX = e.clientX;
			resizeState.startY = e.clientY;
			resizeState.startWidth = $window.width();
			resizeState.startHeight = $window.height();
			resizeState.startLeft = $window.offset().left;
			resizeState.startTop = $window.offset().top;

			$window.addClass("resizing");

			// Bring to front during resize
			self.window_z_index += 1;
			$window.css("z-index", self.window_z_index);

			e.preventDefault();
		});

		const windowResizeHandler = (e) => {
			if (!resizeState.isResizing) return;

			const deltaX = e.clientX - resizeState.startX;
			const deltaY = e.clientY - resizeState.startY;
			const direction = resizeState.direction;

			let newWidth = resizeState.startWidth;
			let newHeight = resizeState.startHeight;
			let newLeft = resizeState.startLeft;
			let newTop = resizeState.startTop;

			// Handle width and horizontal position
			if (direction.includes("right")) {
				newWidth = Math.max(MIN_WIDTH, resizeState.startWidth + deltaX);
			} else if (direction.includes("left")) {
				newWidth = Math.max(MIN_WIDTH, resizeState.startWidth - deltaX);
				newLeft = resizeState.startLeft + deltaX;
			}

			// Handle height and vertical position
			if (direction.includes("bottom")) {
				newHeight = Math.max(MIN_HEIGHT, resizeState.startHeight + deltaY);
			} else if (direction.includes("top")) {
				newHeight = Math.max(MIN_HEIGHT, resizeState.startHeight - deltaY);
				newTop = resizeState.startTop + deltaY;
			}

			// Apply new dimensions
			$window.css({
				width: newWidth + "px",
				height: newHeight + "px",
				left: newLeft + "px",
				top: newTop + "px"
			});
		};

		const windowResizeUpHandler = () => {
			if (resizeState.isResizing) {
				resizeState.isResizing = false;
				$window.removeClass("resizing");
			}
		};

		$(window).on("mousemove", windowResizeHandler);
		$(window).on("mouseup", windowResizeUpHandler);

		// Store handlers on window for cleanup if needed
		$window.data("resize-handlers", { move: windowResizeHandler, up: windowResizeUpHandler });
	}

	load_workspace_content(page, $window) {
		let pages = page.public ? this.public_pages : this.private_pages;
		let current_page = pages.filter((p) => p.title == page.name)[0];
		this._page = current_page;
		this.content = current_page && JSON.parse(current_page.content);

		if (this.content) {
			this.add_custom_cards_in_content();
		}

		// Get data if not cached
		if (this.pages && this.pages[current_page.name]) {
			this.page_data = this.pages[current_page.name];
			this.render_window_content(page, $window);
		} else {
			frappe.after_ajax(() => this.get_data(current_page)).then(() => {
				this.render_window_content(page, $window);
			});
		}
	}

	render_window_content(page, $window) {
		const $content = $window.find(".window-content");
		$content.empty();

		// Create editor JS container for this window
		const editor_id = `window-editor-${frappe.router.slug(page.name)}-${Date.now()}`;
		$content.html(`<div id="${editor_id}" class="desk-page page-main-content" style="padding: 15px;"></div>`);

		// Initialize editor for this window
		this.initialize_window_editor(editor_id, this.content);

		// Store editor reference for this window
		$window.data("workspace-editor", this.editor);

		// Setup routing interception only once
		if (!frappe.views.Container.prototype._workspace_routing_setup) {
			this.setup_window_routing();
		}
	}

	setup_window_routing() {
		// Mark as setup
		frappe.views.Container.prototype._workspace_routing_setup = true;

		// Store original container change_to method
		if (!frappe.views.Container.prototype._original_change_to) {
			frappe.views.Container.prototype._original_change_to = frappe.views.Container.prototype.change_to;
		}

		// Store original body selector getter
		const self = this;
		if (!Object.getOwnPropertyDescriptor(frappe.container, '_original_body_getter')) {
			const original_body = frappe.container.page_body;
			Object.defineProperty(frappe.container, '_original_body_getter', {
				value: () => original_body,
				writable: false
			});
		}

		// Simple router hook - just let navigation happen normally
		// The click handler already saved the route to the window's stack

		// Override change_to to handle window routing
		frappe.views.Container.prototype.change_to = function(label) {
			console.log(`[Deep Link] Container.change_to called with label: ${label}`);
			console.log(`[Deep Link] Active window exists:`, !!self.active_workspace_window);

			// Check if there's an active workspace window
			if (self.active_workspace_window && self.active_workspace_window.is(":visible")) {
				console.log(`[Deep Link] Showing page in window instead of main view`);
				// Prevent normal page change and show in window instead
				return self.show_page_in_window(self.active_workspace_window, label);
			}
			// Otherwise use original behavior
			console.log(`[Deep Link] No active window, using original change_to`);
			return frappe.views.Container.prototype._original_change_to.call(this, label);
		};

		// Override jQuery #body selector for window context
		if (!jQuery.fn._original_html) {
			jQuery.fn._original_html = jQuery.fn.html;
			jQuery.fn._original_append = jQuery.fn.append;
			jQuery.fn._original_prepend = jQuery.fn.prepend;
		}

		// Intercept append/prepend on #body to redirect to active window
		const windowContextWrapper = (originalMethod) => {
			return function(...args) {
				// Check if this is #body and we have an active window
				if (this.is('#body') && self.active_workspace_window && self.active_workspace_window.is(":visible")) {
					const $windowContent = self.active_workspace_window.find('.window-content');
					// If appending content page-container, append to window content instead
					if (args[0] && (args[0].includes && args[0].includes('content page-container') || (typeof args[0] === 'object' && $(args[0]).hasClass('content page-container')))) {
						return originalMethod.call($windowContent, ...args);
					}
				}
				return originalMethod.call(this, ...args);
			};
		};

		jQuery.fn.append = windowContextWrapper(jQuery.fn._original_append);
		jQuery.fn.prepend = windowContextWrapper(jQuery.fn._original_prepend);
	}

	show_page_in_window($window, label) {
		// Don't route during drag operations
		if ($window.data("is-dragging")) {
			return;
		}

		// Get the page element
		let page;
		if (label.tagName) {
			page = label;
		} else {
			page = frappe.pages[label];
		}

		if (!page) {
			console.log(__("Page not found") + ": " + label);
			return;
		}

		// Prevent circular reference: Don't show Workspaces page in a window
		// The Workspaces page contains the windows, so showing it inside a window
		// would create a circular DOM hierarchy
		if (label === 'Workspaces' || page === this.wrapper[0]) {
			console.log("Cannot show Workspaces page in a window (circular reference)");
			return;
		}

		const $content = $window.find(".window-content");
		const $page = $(page);

		// Double-check for circular reference before appending
		if ($.contains(page, $window[0])) {
			console.log("Cannot show page: circular reference detected");
			return;
		}

		// Push current route to this window's stack before navigating
		const workspaceName = $window.attr("data-workspace-name");
		const routeStack = $window.data("route-stack");
		const currentRoute = window.location.pathname;

		// Only push if different from last route
		if (routeStack.length === 0 || routeStack[routeStack.length - 1] !== currentRoute) {
			routeStack.push(currentRoute);
			$window.data("route-stack", routeStack);
			console.log(`[${workspaceName}] Pushed to stack: ${currentRoute}`);
			console.log(`[${workspaceName}] Stack:`, routeStack);
		}

		// Hide the workspace content
		$content.find(".desk-page").hide();

		// Hide all previously shown pages in this window
		$content.find(".window-page-view").remove();

		// Create a wrapper for the page content (don't move the actual page)
		// This avoids DOM hierarchy issues
		const $pageWrapper = $(`<div class="window-page-view" style="width: 100%; height: 100%; overflow: auto;"></div>`);

		// Move the actual page element to the window (not cloning)
		// This ensures all event handlers and Frappe functionality works
		$pageWrapper.append($page);
		$content.append($pageWrapper);

		// Update breadcrumb
		this.update_window_breadcrumb($window, label);

		// Show back button since we just added to history
		$window.find(".btn-window-back").show();

		// Store current page in window
		$window.data("current-page", page);
		$window.data("workspace-active-page", label);

		return page;
	}

	update_window_breadcrumb($window, page_label) {
		const $breadcrumb = $window.find(".breadcrumb-trail");
		const page = frappe.pages[page_label];
		const page_title = page?.label || page_label;

		$breadcrumb.html(` > ${page_title}`).show();
	}

	show_workspace_content_in_window($window) {
		const $content = $window.find(".window-content");
		const workspaceName = $window.attr("data-workspace-name");
		const routeStack = $window.data("route-stack");

		console.log(`[${workspaceName}] Back button clicked`);
		console.log(`[${workspaceName}] Current stack:`, routeStack);

		// IMPORTANT: Set this window as the active window BEFORE navigating
		// This ensures frappe.set_route() will navigate within THIS window, not another one
		this.active_workspace_window = $window;

		// Pop current route from stack
		if (routeStack.length > 0) {
			routeStack.pop();  // Remove current
			$window.data("route-stack", routeStack);
		}

		// Get previous route (now at top of stack)
		const previousRoute = routeStack.length > 0 ? routeStack[routeStack.length - 1] : null;

		console.log(`[${workspaceName}] Previous route:`, previousRoute);
		console.log(`[${workspaceName}] Stack after pop:`, routeStack);

		// Check if we have a previous route
		if (previousRoute) {
			// Navigate to previous route (will use THIS window because we set it as active above)
			const routeParts = previousRoute.replace('/app/', '').split('/').filter(p => p);
			console.log(`[${workspaceName}] Navigating to:`, routeParts);
			frappe.set_route(routeParts);
			return;
		}

		// No history - show workspace content
		console.log(`[${workspaceName}] No more history - showing workspace`);

		// Hide any page views
		$content.find(".window-page-view").remove();

		// Show workspace content
		$content.find(".desk-page").show();

		// Hide back button
		$window.find(".btn-window-back").hide();

		// Clear breadcrumb
		$window.find(".breadcrumb-trail").html("");

		// Clear stored page
		$window.data("current-page", null);
		$window.data("workspace-active-page", null);

		// Navigate to workspace route
		const workspacePage = $window.data("workspace-page");
		if (workspacePage) {
			const workspaceRouteParts = workspacePage.public
				? [frappe.router.slug(workspacePage.name)]
				: ['private', frappe.router.slug(workspacePage.name)];
			frappe.set_route(workspaceRouteParts);
		}
	}

	cleanup_window_pages($window) {
		const $content = $window.find(".window-content");
		// Remove any cloned page views in this window
		$content.find(".window-page-view").remove();
	}

	initialize_window_editor(editor_id, blocks) {
		// Check if element exists, if not wait a bit
		if (!document.getElementById(editor_id)) {
			// Element not found, retry after a short delay
			setTimeout(() => this.initialize_window_editor(editor_id, blocks), 50);
			return;
		}

		const tools = {
			header: {
				class: this.blocks["header"],
				inlineToolbar: ["HeaderSize", "bold", "italic", "link"],
				config: {
					default_size: 4,
				},
			},
			paragraph: {
				class: this.blocks["paragraph"],
				inlineToolbar: ["HeaderSize", "bold", "italic", "link"],
				config: {
					placeholder: __("Choose a block or continue typing"),
				},
			},
			chart: {
				class: this.blocks["chart"],
				config: {
					page_data: this.page_data || [],
				},
			},
			card: {
				class: this.blocks["card"],
				config: {
					page_data: this.page_data || [],
				},
			},
			shortcut: {
				class: this.blocks["shortcut"],
				config: {
					page_data: this.page_data || [],
				},
			},
			onboarding: {
				class: this.blocks["onboarding"],
				config: {
					page_data: this.page_data || [],
				},
			},
			quick_list: {
				class: this.blocks["quick_list"],
				config: {
					page_data: this.page_data || [],
				},
			},
			number_card: {
				class: this.blocks["number_card"],
				config: {
					page_data: this.page_data || [],
				},
			},
			custom_block: {
				class: this.blocks["custom_block"],
				config: {
					page_data: this.page_data || [],
				},
			},
			spacer: this.blocks["spacer"],
			HeaderSize: frappe.workspace_block.tunes["header_size"],
		};

		try {
			const editor = new EditorJS({
				holder: editor_id,
				data: {
					blocks: blocks || [],
				},
				tools: tools,
				autofocus: false,
				readOnly: true,
				logLevel: "ERROR",
			});
		} catch (error) {
			console.error("Error initializing editor:", error);
		}
	}

	save_page(page) {
		let me = this;
		this.current_page = { name: page.title, public: page.public };

		return this.editor
			.save()
			.then((outputData) => {
				let new_widgets = {};

				outputData.blocks.forEach((item) => {
					if (item.data.new) {
						if (!new_widgets[item.type]) {
							new_widgets[item.type] = [];
						}
						new_widgets[item.type].push(item.data.new);
						delete item.data["new"];
					}
				});

				let blocks = outputData.blocks.filter(
					(item) =>
						item.type != "card" ||
						(item.data.card_name !== "Custom Documents" &&
							item.data.card_name !== "Custom Reports")
				);

				if (
					page.content == JSON.stringify(blocks) &&
					Object.keys(new_widgets).length === 0
				) {
					this.setup_customization_buttons(page);
					frappe.show_alert({
						message: __("No changes made on the page"),
						indicator: "warning",
					});
					return false;
				}

				this.create_page_skeleton();
				page.content = JSON.stringify(blocks);
				frappe.call({
					method: "frappe.desk.doctype.workspace.workspace.save_page",
					args: {
						title: page.title,
						public: page.public || 0,
						new_widgets: new_widgets,
						blocks: JSON.stringify(blocks),
					},
					callback: function (res) {
						if (res.message) {
							me.discard = true;
							me.update_cached_values(page, page);
							me.reload();
							frappe.show_alert({
								message: __("Page Saved Successfully"),
								indicator: "green",
							});
						}
					},
				});
				return true;
			})
			.catch((error) => {
				error;
				// console.log('Saving failed: ', error);
			});
	}

	reload() {
		this.sorted_public_items = [];
		this.sorted_private_items = [];
		this.setup_pages(true);
		this.discard = false;
		this.undo.readOnly = true;
	}

	create_page_skeleton() {
		if (this.body.find(".workspace-skeleton").length) return;

		this.body.prepend(frappe.render_template("workspace_loading_skeleton"));
		this.body.find(".codex-editor").addClass("hidden");
	}

	remove_page_skeleton() {
		this.body.find(".codex-editor").removeClass("hidden");
		this.body.find(".workspace-skeleton").remove();
	}

	create_sidebar_skeleton() {
		if ($(".workspace-sidebar-skeleton").length) return;

		$(frappe.render_template("workspace_sidebar_loading_skeleton")).insertBefore(this.sidebar);
		this.sidebar.addClass("hidden");
	}

	remove_sidebar_skeleton() {
		this.sidebar.removeClass("hidden");
		$(".workspace-sidebar-skeleton").remove();
	}

	register_awesomebar_shortcut() {
		"abcdefghijklmnopqrstuvwxyz".split("").forEach((letter) => {
			const default_shortcut = {
				action: (e) => {
					$("#navbar-search").focus();
					return false; // don't prevent default = type the letter in awesomebar
				},
				page: this.page,
			};
			frappe.ui.keys.add_shortcut({ shortcut: letter, ...default_shortcut });
			frappe.ui.keys.add_shortcut({ shortcut: `shift+${letter}`, ...default_shortcut });
		});
	}

	// Deep Link Handling System
	// ========================

	setup_deep_link_routing() {
		// Hook into frappe.router to intercept deep links before pages render
		const self = this;

		console.log("[Deep Link] Setting up global routing hook");
		console.log("[Deep Link] frappe.router exists:", !!frappe.router);

		// Try different event binding methods
		// Method 1: jQuery-style event
		if (typeof $(frappe.router).on === 'function') {
			console.log("[Deep Link] Using jQuery event binding");
			$(frappe.router).on("change", async function() {
				console.log("[Deep Link] Router change event fired (jQuery)");
				await self.handle_deep_link_on_route_change();
			});
		}

		// Method 2: Direct frappe.router.on if it exists
		if (typeof frappe.router.on === 'function') {
			console.log("[Deep Link] Using frappe.router.on event binding");
			frappe.router.on("change", async function() {
				console.log("[Deep Link] Router change event fired (frappe.router.on)");
				await self.handle_deep_link_on_route_change();
			});
		}

		// Method 3: Wrap the render method directly
		if (!frappe.router._original_render) {
			console.log("[Deep Link] Wrapping frappe.router.render method");
			frappe.router._original_render = frappe.router.render;
			frappe.router.render = function(...args) {
				console.log("[Deep Link] Router render called, current_route:", frappe.router.current_route);

				// Check if we should handle as deep link (async operation)
				if (self.all_pages && self.all_pages.length > 0) {
					// Capture context and arguments
					const renderContext = this;

					// Run async deep link handling
					self.handle_deep_link_on_route_change().then((handled) => {
						console.log("[Deep Link] Async handling complete, handled =", handled);

						// Always call render - if handled, active window is set
						// and existing window routing will redirect page to window
						frappe.router._original_render.apply(renderContext, args);
					});

					// Don't render immediately - wait for async handling
					return;
				}

				// Call original render
				return frappe.router._original_render.apply(this, args);
			};
		}

		console.log("[Deep Link] Global routing hook installed");
	}

	async handle_deep_link_on_route_change() {
		// Prevent re-entrant calls while handling a deep link
		if (this._handling_deep_link) {
			console.log("[Deep Link] Already handling a deep link, skipping");
			return false;
		}

		const route = frappe.router.current_route;

		console.log("[Deep Link] Checking route:", route);

		if (!route || route.length === 0) {
			console.log("[Deep Link] No route");
			return false;
		}

		// Check if this is a workspace route
		const first_part = route[0];
		if (first_part === "Workspaces") {
			console.log("[Deep Link] This is a workspace route, skipping");
			return false;
		}

		// Check if this is a doctype-related route (Form, List, Report, Tree, etc.)
		const doctype_views = ["Form", "List", "Report", "Tree", "Kanban", "Calendar", "Gantt", "Dashboard", "Image", "Inbox", "Map"];
		if (!doctype_views.includes(first_part)) {
			console.log("[Deep Link] Not a doctype view, skipping");
			return false;
		}

		// Extract the doctype from the route
		const doctype = route[1];
		if (!doctype) {
			console.log("[Deep Link] No doctype in route");
			return false;
		}

		// Check if we already have a workspace window open for this
		if (this.active_workspace_window && this.active_workspace_window.is(":visible")) {
			console.log("[Deep Link] Already have active workspace window, letting page render in window");
			// Return false so page renders, but existing window routing will catch it
			return false;
		}

		console.log(`[Deep Link] Detected deep link to ${first_part} view for doctype: ${doctype}`);

		// Set flag to prevent re-entrant calls
		this._handling_deep_link = true;

		try {
			// Find which workspace contains this doctype
			let workspace = await this.find_workspace_for_doctype(doctype);

			if (!workspace) {
				console.log(`[Deep Link] No specific workspace found for doctype: ${doctype}`);
				console.log(`[Deep Link] Using fallback workspace strategy`);

				// FALLBACK STRATEGY: Use a default workspace
				workspace = this.get_fallback_workspace();

				if (!workspace) {
					console.log(`[Deep Link] ERROR: No fallback workspace available, allowing default behavior`);
					return false;
				}

				console.log(`[Deep Link] Using fallback workspace: ${workspace.name}`);
			} else {
				console.log(`[Deep Link] Found workspace "${workspace.name}" for doctype: ${doctype}`);
			}

			// Open the workspace window and navigate to the deep link
			await this.open_workspace_for_deep_link(workspace, route);

			// Return true to indicate we handled this deep link
			return true;
		} finally {
			// Clear flag after handling
			this._handling_deep_link = false;
		}
	}

	build_doctype_workspace_map() {
		// Build a mapping of doctypes to their workspaces
		// This allows us to determine which workspace to open for a deep link
		this.doctype_workspace_map = {};

		// For each workspace, we'll need to fetch its links to build the mapping
		// Since we don't have the full workspace data yet, we'll build this on-demand
		console.log("[Deep Link] Doctype-workspace mapping system initialized");
	}

	async handle_deep_link() {
		// Check if current route is a deep link (non-workspace route)
		const route = frappe.router.current_route;
		
		if (!route || route.length === 0) {
			return false;
		}

		// Check if this is a workspace route
		const first_part = route[0];
		if (first_part === "Workspaces") {
			// This is a workspace route, not a deep link
			return false;
		}

		// Check if this is a doctype-related route (Form, List, Report, Tree, etc.)
		const doctype_views = ["Form", "List", "Report", "Tree", "Kanban", "Calendar", "Gantt", "Dashboard", "Image", "Inbox", "Map"];
		if (!doctype_views.includes(first_part)) {
			// Not a doctype view, let it handle normally
			return false;
		}

		// Extract the doctype from the route
		// Routes are like: ["Form", "User", "user-001"] or ["List", "User"]
		const doctype = route[1];
		if (!doctype) {
			return false;
		}

		console.log(`[Deep Link] Detected deep link to ${first_part} view for doctype: ${doctype}`);
		console.log(`[Deep Link] Full route:`, route);

		// Find which workspace contains this doctype
		const workspace = await this.find_workspace_for_doctype(doctype);

		if (!workspace) {
			console.log(`[Deep Link] No workspace found for doctype: ${doctype}, showing in main view`);
			return false; // Let it show in main view
		}

		console.log(`[Deep Link] Found workspace "${workspace.name}" for doctype: ${doctype}`);

		// Open the workspace window and navigate to the deep link
		await this.open_workspace_for_deep_link(workspace, route);

		return true; // Deep link was handled
	}

	async find_workspace_for_doctype(doctype) {
		// Use Frappe's built-in DocType → Module → Workspace relationship
		// This is the proper Frappe way to determine workspace

		console.log(`[Deep Link] Finding workspace for doctype: ${doctype} using Frappe's module system`);

		try {
			// Call server-side method to get workspace via module
			const result = await frappe.call({
				method: "frappe.desk.desktop.get_doctype_workspace",
				args: {
					doctype: doctype
				}
			});

			if (result && result.message) {
				console.log(`[Deep Link] Found workspace via module: ${result.message.name}`);
				return result.message;
			}

			console.log(`[Deep Link] No workspace found via module for doctype: ${doctype}`);

		} catch (error) {
			console.error(`[Deep Link] Error getting workspace for doctype ${doctype}:`, error);
		}

		// Fallback: Try to match workspace name to doctype name with simple heuristics
		// e.g., "User" doctype -> "Users" workspace
		console.log(`[Deep Link] Trying heuristic matching for doctype: ${doctype}`);

		for (let page of this.all_pages) {
			const workspace_name_lower = page.title.toLowerCase();
			const doctype_lower = doctype.toLowerCase();

			// Check if workspace name contains doctype or vice versa
			if (workspace_name_lower.includes(doctype_lower) || doctype_lower.includes(workspace_name_lower)) {
				console.log(`[Deep Link] Using heuristic match: "${page.title}" for doctype "${doctype}"`);
				return { name: page.title, public: page.public };
			}
		}

		return null;
	}

	async open_workspace_for_deep_link(workspace, target_route) {
		// Open the workspace window
		console.log(`[Deep Link] Opening workspace window: ${workspace.name}`);

		// Check if window is already open
		const existing_window = $(`.workspace-window[data-page-name="${workspace.name}"]`);
		if (existing_window.length > 0) {
			console.log(`[Deep Link] Workspace window already open, using existing window`);
			this.active_workspace_window = existing_window;
			console.log(`[Deep Link] Set active window, existing routing will handle page display`);
			return;
		}

		// Open new workspace window
		this.open_workspace_window({ name: workspace.name, public: workspace.public });

		// Set the newly created window as active immediately
		// Use a short timeout to ensure DOM is updated
		await new Promise(resolve => setTimeout(resolve, 100));

		const $window = $(`.workspace-window[data-page-name="${workspace.name}"]`);
		if ($window.length > 0) {
			this.active_workspace_window = $window;
			console.log(`[Deep Link] Set active window, existing routing will handle page display`);
		} else {
			console.log(`[Deep Link] WARNING: Window not found after creation`);
		}
	}

	async handle_pending_deep_link(pending) {
		console.log(`[Deep Link] Handling pending deep link: ${pending.view} for ${pending.doctype}`);

		// Find which workspace contains this doctype
		let workspace = await this.find_workspace_for_doctype(pending.doctype);

		if (!workspace) {
			console.log(`[Deep Link] No specific workspace found for doctype: ${pending.doctype}`);
			console.log(`[Deep Link] Using fallback workspace strategy`);

			// FALLBACK STRATEGY: Use a default workspace
			workspace = this.get_fallback_workspace();

			if (!workspace) {
				console.log(`[Deep Link] ERROR: No fallback workspace available, allowing normal behavior`);
				// Re-route to the original deep link to show in main view
				setTimeout(() => {
					frappe.set_route(pending.route);
				}, 100);
				return;
			}

			console.log(`[Deep Link] Using fallback workspace: ${workspace.name}`);
		} else {
			console.log(`[Deep Link] Found workspace "${workspace.name}" for doctype: ${pending.doctype}`);
		}

		// We're already on a workspace page (redirected there by global handler)
		// Just open the workspace window and navigate to the deep link
		await this.open_workspace_for_deep_link(workspace, pending.route);

		// Now re-trigger the original route to show in window
		console.log("[Deep Link] Re-triggering original route in window:", pending.route);
		setTimeout(() => {
			frappe.set_route(pending.route);
		}, 200);
	}

	get_fallback_workspace() {
		// Try to find a good fallback workspace to use when doctype isn't found
		// Priority: Home > Tools > Build > First available

		const fallback_names = ["Home", "Tools", "Build", "Website"];

		for (let name of fallback_names) {
			const workspace = this.all_pages.find(p => p.title === name);
			if (workspace) {
				console.log(`[Deep Link] Found fallback workspace: ${name}`);
				return { name: workspace.title, public: workspace.public };
			}
		}

		// If none of the preferred fallbacks exist, use the first available workspace
		if (this.all_pages && this.all_pages.length > 0) {
			const first = this.all_pages[0];
			console.log(`[Deep Link] Using first available workspace: ${first.title}`);
			return { name: first.title, public: first.public };
		}

		return null;
	}

};
