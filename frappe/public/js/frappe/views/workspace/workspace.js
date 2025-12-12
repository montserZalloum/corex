import EditorJS from "@editorjs/editorjs";
import Undo from "editorjs-undo";

// Global Deep Link Handler - Initialize before workspace constructor
// This ensures deep links work even on page refresh
frappe.provide("frappe.workspace_deep_link");

frappe.workspace_deep_link = {
	workspace_instance: null,

	init() {
		// Wait for frappe app/router to be ready
		$(document).ready(() => {
			if (frappe.router) {
				this.setup_router_hooks();
			} else {
				const checkRouter = setInterval(() => {
					if (frappe.router) {
						clearInterval(checkRouter);
						this.setup_router_hooks();
					}
				}, 100);
			}
			// Force hard refresh on Logo click
            $('body').on('click', 'header .navbar-brand.navbar-home', function(e) {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = $(this).attr('href');
            });

		});
	},

	setup_router_hooks() {
		// Wrap router.render to intercept deep links ONE time
		if (!frappe.router._deep_link_render_wrapped) {
			frappe.router._deep_link_render_wrapped = true;
			// Store original for potential cleanup
			frappe.router._original_render = frappe.router.render;
			const original_render = frappe.router._original_render;

			frappe.router.render = function(...args) {
				// 1. Check if workspace instance exists to handle the logic
				if (frappe.workspace && frappe.workspace.handle_deep_link_on_route_change) {
					// Delegate entirely to the instance.
					// We pass the args to original_render inside the promise callback
					// ONLY if the workspace logic decides to proceed.
					frappe.workspace.handle_deep_link_on_route_change().then((handled) => {
						// Always call original render to keep Frappe state in sync.
						// If 'handled' was true, the workspace has already set up the 
						// window routing hooks to redirect this render into a window.
						original_render.apply(frappe.router, args);
					});
					return;
				}

				// 2. Fallback: Workspace not loaded yet
				const route = frappe.router.current_route;
				if (route && route.length > 0) {
					const first_part = route[0];
					const doctype_views = ["Form", "List", "Report", "Tree", "Kanban", "Calendar", "Gantt", "Dashboard", "Image", "Inbox", "Map","query-report", "dashboard-view"];

					if (doctype_views.includes(first_part)) {
						frappe.workspace_deep_link.pending_deep_link = { route, doctype: route[1], view: first_part };
						
						// Redirect to Workspaces to force initialization
						setTimeout(() => {
							if (frappe.workspaces && Object.keys(frappe.workspaces).length > 0) {
								frappe.set_route("Workspaces", Object.values(frappe.workspaces)[0].title);
							} else {
								frappe.set_route("Workspaces", "Home");
							}
						}, 100);
						return; 
					}
				}

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
		this.pages = {}; // NOTE: Page data caching disabled - kept for backwards compatibility
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
		this.minimized_windows = []; // Track minimized windows for dock
		this.dock_element = null; // Reference to dock container

		this.prepare_container();
		this.setup_pages();
		this.register_awesomebar_shortcut();

		// Setup global deep link routing hook
		this.setup_deep_link_routing();

		// FIX: Initialize window routing immediately. 
		// Do NOT wait for a window to open, otherwise the first deep link will race and fail.
		this.setup_window_routing();
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

		// Initialize macOS-style dock for minimized windows
		this.initialize_workspace_dock();
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
			page.is_editable = (!page.public && page.for_user === frappe.session.user) || this.has_access;
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

				// Set flag to indicate we're processing a deep link during initialization
				// This prevents navigate_to_default_link from overriding the deep link
				this.deep_link_processed_on_init = true;

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
			<button data-label="Edit" class="btn btn-default ellipsis btn-edit-main-workspace" title="Edit Current Workspace">
				<svg class="es-icon es-line icon-xs" style="" aria-hidden="true">
					<use class="" href="#es-line-edit"></use>
				</svg>
				<span class="hidden-xs" data-label="Edit">${__("Edit")}</span>
			</button>
		</div>
	`).appendTo(this.body);

		this.body.find(".btn-new-workspace").on("click", () => {
			this.initialize_new_page(true);
		});

		this.body.find(".btn-edit-main-workspace").on("click", (e) => {
			$(e.currentTarget).hide();
			document.body.classList.add('edit-main-screen')
			this.edit_current_workspace();
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
				item-id="${item.name}"
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
						class="item-anchor ${item.is_editable ? "" : "block-click"}" title="${__(item.title)}" data-workspace-id="${item.name}"
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
		// Clear previous sidebar_items to prevent memory leak
		this.sidebar_items = {
			public: {},
			private: {},
		};

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

		// Register workspace anchor click handler once using event delegation
		// This prevents duplicate handlers from being registered multiple times
		// (previously was being registered in build_sidebar_section, causing double-opens)
		this.sidebar.off("click", ".item-anchor").on("click", ".item-anchor", (e) => {
			e.preventDefault();
			// Close sidebar
			$(".list-sidebar.hidden-xs.hidden-sm").removeClass("opened");
			$(".close-sidebar").css("display", "none");
			$("body").css("overflow", "auto");

			// Open workspace in a window instead of navigating
			const $anchor = $(e.currentTarget);
			const workspace_id = $anchor.attr("data-workspace-id"); // Use internal workspace name (e.g., "my-admin")
			const page_title = $anchor.attr("title"); // For display only
			const is_public = $anchor.closest(".sidebar-item-container").attr("item-public") === "1";

			this.open_workspace_window({ name: workspace_id, public: is_public, title: page_title });
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
			$e.parents('.standard-sidebar-section').find(".sidebar-item-container").toggleClass("hidden");
			$e.attr("aria-expanded", String(!isCollapsed));
		});

		if (Object.keys(root_pages).length === 0) {
			sidebar_section.addClass("hidden");
		}

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
			let sidebar_page = pages.find((p) => p.name == page.name);  // Compare by internal workspace name

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

				// NOTE: Caching removed - always fetch fresh data
				// This reduces memory usage and prevents stale data

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
				// this.editor.configuration.tools.onboarding.config.page_data = this.page_data;
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
		let current_page = pages.filter((p) => p.name == page.name)[0];  // Filter by internal workspace name

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

		// NOTE: Page block data caching removed (we now fetch fresh data each time)

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
				frappe.set_route("/app");

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
				new_page.is_editable = (!new_page.public && new_page.for_user === frappe.session.user) || this.has_access;
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
				onMove: function (evt) {
					let from_container = $(evt.from);
					let to_container = $(evt.to);
					let desk_sidebar = $(".cx-ROOT-layout > .layout-side-section > .list-sidebar > .desk-sidebar");
					let sections = desk_sidebar.find(".standard-sidebar-section");
					let section_count = sections.length;
					// Determine if from/to sections are public based on section count
					// If only 1 section: it's public (no private section exists)
					// If 2 sections: first is private, second is public
					let from_section = from_container.closest(".standard-sidebar-section");
					let to_section = to_container.closest(".standard-sidebar-section");

					let from_is_public = section_count === 1 || from_section.is(sections.last());
					let to_is_public = section_count === 1 || to_section.is(sections.last());

					// Check if trying to move item between public and private sections
					if (from_is_public !== to_is_public) {
						return false;
					}
				},
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

				// Only initialize undo if editor exists (old full-page editing mode)
				if (this.editor) {
					this.initialize_editorjs_undo();
					this.setup_customization_buttons({ is_editable: true });
				}

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

				// Save workspace to database
				frappe.call({
					method: "frappe.desk.doctype.workspace.workspace.new_page",
					args: {
						new_page: new_page,
					},
					callback: (res) => {
						if (res.message) {
							let message = __("Workspace {0} Created Successfully", [
								new_page.title.bold(),
							]);
							frappe.show_alert({
								message: message,
								indicator: "green",
							});

							// Update local cache and navigate
							this.update_cached_values(new_page, new_page, true, true);

							let pre_url = new_page.public ? "" : "private/";
							let route = pre_url + frappe.router.slug(new_page.title);
							frappe.set_route(route);

							this.make_sidebar();
							this.show_sidebar_actions();
							localStorage.setItem("new_workspace", JSON.stringify(new_page));
						}
					},
				});

				// Only render in editor if it exists (old full-page editing mode)
				if (this.editor) {
					this.editor.render({
						blocks: blocks,
					});

					if (this.editor.configuration.readOnly) {
						this.is_read_only = false;
						this.editor.readOnly.toggle();
					}
				}
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
			// onboarding: {
			// 	class: this.blocks["onboarding"],
			// 	config: {
			// 		page_data: this.page_data || [],
			// 	},
			// },
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
			holder: this.page.main.find(".editor-js-container").get(0),
			data: {
				blocks: blocks || [],
			},
			tools: this.tools,
			autofocus: false,
			readOnly: true,
			logLevel: "ERROR",
		});
	}

	open_workspace_window(page, is_deep_link = false) {
		// Create a unique window ID for this workspace
		// Use timestamp + random to avoid issues with special characters in workspace names (like @ in emails)
		const window_id = `workspace-window-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const windowIndex = document.querySelectorAll('.workspace-window').length + 1;
		// Increment z-index for new windows (always on top)
		this.window_z_index += 1;
		const current_z_index = this.window_z_index;

		// Display title: use provided title or fall back to name
		const display_title = page.title || page.name;
		let title; 
		let worksSpaceLink;
		if (page.title) {
			title = page.title.toLowerCase().split(' ').join('-');
			worksSpaceLink = page.public ? title : 'private/'+title
		} else {
			title = page.name.toLowerCase().split(' ').join('-');
			worksSpaceLink = page.public ? title : 'private/'+title
		}
		if (page.public) {
			worksSpaceLink = page.name.toLowerCase().split(' ').join('-')
		}
		
		// Create window container with inner content area 
		const $window = $(`
			<div class="workspace-window" data-workspace-name-only="${worksSpaceLink.replace('private/','')}" data-workspace-link="/${worksSpaceLink}" id="${window_id}" data-page-name="${page.name}" data-page-public="${page.public}" style="--index:${windowIndex};z-index: ${current_z_index};">
				<div class="window-titlebar">
					<div class="window-breadcrumb">
						<span class="window-title">${display_title}</span>
						<span class="breadcrumb-trail" style="display: none;"></span>
					</div>
					<div class="window-controls">
						<button class="btn-window-back flip-ar" title="Back" style="display: none;">←</button>
						<button class="btn-window-edit" title="Edit Workspace" style="${page.public && !this.has_access ? 'display: none;' : ''}">✎</button>
						<button class="btn-window-minimize" title="Minimize">_</button>
						<button class="btn-window-maximize" title="Maximize">□</button>
						<button class="btn-window-close" title="Close">×</button>
					</div>
				</div>
				<div class="window-content">
					<div class="window-loader" style="text-align: center; padding: 20px;">
						<p>Loading ${display_title}...</p>
					</div>
				</div>
				<div class="toggle-sidebar-menu">
					←
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

		// FIX: Set the deep link flag immediately upon creation
		if (is_deep_link) {
			$window.data("is-deep-linking", true);
            // Cleanup flag after 3 seconds to allow future interactions to work normally
            setTimeout(() => {
                $window.data("is-deep-linking", false);
            }, 3000);
		}

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
			$window.addClass('closing-window')
			// Trigger home link click to navigate to workspace before closing
			// This ensures the route is properly updated to the workspace route
			const $home_link = $window.find(".sidebar-home-link");
			if ($home_link.length) {
				$home_link.trigger("click");
			} else {
				// Fallback: use workspace-link data attribute if home link doesn't exist
				const workspaceLink = $window.data('workspace-link');
				if (workspaceLink) {
					frappe.set_route(workspaceLink);
				}
			}
			// Delay closing to allow navigation to complete
			setTimeout(() => {
				// Remove from minimized windows list if applicable
				if ($window.hasClass("minimized-to-dock")) {
					const windowId = $window.attr("id");
					this.minimized_windows = this.minimized_windows.filter(w => w.id !== windowId);
					this.update_dock_visibility();
					// Remove dock item
					this.dock_element.find(`[data-window-id="${windowId}"]`).remove();
				}

				// Remove all pages created for this window
				this.cleanup_window_pages($window);
				$window.fadeOut(200, function() {
					$(this).remove();
				});
			}, 100);
		});

		$window.find(".btn-window-minimize").on("click", () => {
			const isMinimized = $window.hasClass("minimized-to-dock");

			if (isMinimized) {
				// Restore from dock
				this.restore_window_from_dock($window);
			} else {
				// Minimize to dock
				this.minimize_window_to_dock($window);
			}
		});

		$window.find(".btn-window-maximize").on("click", () => {
			const isMaximized = $window.data("is-maximized");

			if (isMaximized) {
				// Restore to previous size
				const savedPos = $window.data("saved-position");
				if (savedPos) {
					$window.css({
						position: "fixed",
						left: savedPos.left + "px",
						right: "auto",
						top: savedPos.top + "px",
						width: savedPos.width + "px",
						height: savedPos.height + "px",
						"border-radius": "18px",
						"z-index": savedPos.zIndex,
						border: "1px solid rgba(255, 255, 255, 0.45)",
						"backdrop-filter": "blur(30px) saturate(180%)",
						"-webkit-backdrop-filter": "blur(30px) saturate(180%)",
						animation: "slideInMac 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
						transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
					});
				}
				$window.data("is-maximized", false);
			} else {
				// Save current position and maximize
				const currentZ = parseInt($window.css("z-index")) || 1000;
				$window.data("saved-position", {
					left: $window.position().left,
					top: $window.position().top,
					width: $window.width(),
					height: $window.height(),
					zIndex: currentZ
				});

				// Apply maximize styles directly without adding class
				$window.css({
					position: "fixed",
					left: "0",
					right: "0",
					top: "0",
					width: "100%",
					height: "100%",
					"border-radius": "0",
					"z-index": "2000",
					animation: "none",
					border: "none"
				});

				$window.data("is-maximized", true);

				// Bring window to front
				this.window_z_index += 1;
				$window.css("z-index", this.window_z_index);
			}
		});

		$window.find(".btn-window-back").on("click", () => {
			this.show_workspace_content_in_window($window);
		});

		$window.find(".btn-window-edit").on("click", async () => {
			await this.toggle_window_edit_mode($window, page);
		});

		$window.find(".toggle-sidebar-menu").on("click", () => {
			const $sidebar = $window.find(".window-sidebar");
			$sidebar.toggle();
			$window.toggleClass('hide-leftside-menu')
		});

		// Load workspace content
		this.load_workspace_content(page, $window);

		return $window;
	}

	show_window_menu($window, page) {
		// Close any existing menus
		$(".window-menu-dropdown").remove();

		const $menuButton = $window.find(".btn-window-menu");
		const menuItems = [];
		const self = this; // Store reference to workspace instance

		// Add duplicate option
		menuItems.push({
			label: __("Duplicate"),
			icon: frappe.utils.icon("es-line-duplicate", "sm"),
			action: () => {
				$(".window-menu-dropdown").remove();
				self.duplicate_page(page);
			}
		});

		// Create menu dropdown
		const $menu = $(`<div class="window-menu-dropdown"></div>`);

		menuItems.forEach(item => {
			const $item = $(`
				<div class="window-menu-item">
					<span class="menu-item-icon">${item.icon}</span>
					<span class="menu-item-label">${item.label}</span>
				</div>
			`);
			$item.on("click", item.action);
			$menu.append($item);
		});

		// Position menu below button
		const btnOffset = $menuButton.offset();
		$menu.css({
			position: "fixed",
			top: btnOffset.top + $menuButton.outerHeight() + 5,
			left: btnOffset.left - $menu.width() + $menuButton.width(),
			zIndex: parseInt($window.css("z-index")) + 1
		});

		// Add menu to body and attach close handler
		$menu.appendTo("body");

		// Close menu when clicking outside
		$(document).on("click.window-menu", function(e) {
			if (!$(e.target).closest(".window-menu-dropdown, .btn-window-menu").length) {
				$(".window-menu-dropdown").remove();
				$(document).off("click.window-menu");
			}
		});
	}

	edit_current_workspace() {
		// Get the current workspace being displayed
		const page = this.get_page_to_show();

		if (!page) {
			frappe.show_alert({
				message: __("No workspace selected"),
				indicator: "orange"
			});
			return;
		}

		// Get or create the editor for the main workspace
		if (!this.editor) {
			// Initialize editor if it doesn't exist
			this.prepare_editorjs();
		}

		// Enter edit mode
		if (this.editor) {
			// Check if already in edit mode
			if (this.is_read_only) {
				this.is_read_only = false;

				// Toggle editor to edit mode
				this.editor.isReady.then(async () => {
					await this.editor.readOnly.toggle();

					// Add visual indication of edit mode
					this.page.main.addClass("edit-mode");

					// Setup edit controls
					this.setup_customization_buttons(page);
					this.show_sidebar_actions();

					// Initialize sortable for blocks
					this.make_blocks_sortable();

					// Update button UI
					const $editBtn = this.page.main.find(".btn-edit-main-workspace");
					$editBtn.attr("title", "Save Changes").html(`
						<svg class="es-icon es-line icon-xs" style="" aria-hidden="true">
							<use class="" href="#es-line-save"></use>
						</svg>
						<span class="hidden-xs">${__("Save")}</span>
					`);

					// Change to save mode
					$editBtn.off("click").on("click", () => {
						this.save_main_workspace(page);
					});

					// Add cancel button if not exists
					if (!this.page.main.find(".btn-cancel-main-workspace").length) {
						$editBtn.after(`
							<button class="btn btn-default ellipsis btn-cancel-main-workspace" title="Cancel">
								<svg class="es-icon es-line icon-xs" style="" aria-hidden="true">
									<use class="" href="#es-line-close"></use>
								</svg>
								<span class="hidden-xs">${__("Cancel")}</span>
							</button>
						`);

						this.page.main.find(".btn-cancel-main-workspace").on("click", () => {
							window.location.href = "/app";
							this.cancel_main_workspace_edit(page);
						});
					}

					frappe.show_alert({
						message: __("Edit mode enabled"),
						indicator: "blue"
					});
				});
			} else {
				// Already in edit mode, save instead
				this.save_main_workspace(page);
			}
		}
	}

	save_main_workspace(page) {
		// Save workspace content from main editor
		this.editor.save().then((outputData) => {
			// Extract new widgets
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

			// Filter blocks
			let blocks = outputData.blocks.filter(
				(item) =>
					item.type != "card" ||
					(item.data.card_name !== "Custom Documents" &&
						item.data.card_name !== "Custom Reports")
			);

			// Save to backend
			frappe.call({
				method: "frappe.desk.doctype.workspace.workspace.save_page",
				args: {
					title: page.title,
					public: page.public ? 1 : 0,
					new_widgets: new_widgets,
					blocks: JSON.stringify(blocks)
				},
				callback: async (res) => {
					if (res.message) {
						// Exit edit mode
						this.is_read_only = true;
						await this.editor.readOnly.toggle();

						this.page.main.removeClass("edit-mode");

						// Restore edit button
						const $editBtn = this.page.main.find(".btn-edit-main-workspace");
						$editBtn.attr("title", "Edit Current Workspace").html(`
							<svg class="es-icon es-line icon-xs" style="" aria-hidden="true">
								<use class="" href="#es-line-edit"></use>
							</svg>
							<span class="hidden-xs">${__("Edit")}</span>
						`);

						// Reset click handler
						$editBtn.off("click").on("click", () => {
							this.edit_current_workspace();
						});

						// Remove cancel button
						this.page.main.find(".btn-cancel-main-workspace").remove();

						frappe.show_alert({
							message: __("Workspace saved successfully"),
							indicator: "green"
						});
					}
				}
			});
		});
	}

	cancel_main_workspace_edit(page) {
		// Cancel edit mode
		this.editor.isReady.then(async () => {
			await this.editor.readOnly.toggle();
		});

		this.is_read_only = true;
		this.page.main.removeClass("edit-mode");

		// Restore edit button
		const $editBtn = this.page.main.find(".btn-edit-main-workspace");
		$editBtn.attr("title", "Edit Current Workspace").html(`
			<svg class="es-icon es-line icon-xs" style="" aria-hidden="true">
				<use class="" href="#es-line-edit"></use>
			</svg>
			<span class="hidden-xs">${__("Edit")}</span>
		`);

		// Reset click handler
		$editBtn.off("click").on("click", () => {
			this.edit_current_workspace();
		});

		// Remove cancel button
		this.page.main.find(".btn-cancel-main-workspace").remove();

		// Reload content to discard changes
		this.prepare_editorjs();

		frappe.show_alert({
			message: __("Edit cancelled"),
			indicator: "orange"
		});
	}

	make_window_draggable($window) {
		const dragState = {
			isDown: false,
			offset: [0, 0],
			snapRegion: null // Track which snap region the cursor is in
		};
		const $titlebar = $window.find(".window-titlebar");
		const self = this;
		const SNAP_THRESHOLD = 60; // pixels from edge to trigger snap region

		$titlebar.on("mousedown", (e) => {
			// Don't drag if clicking on a button
			if ($(e.target).closest("button").length) return;

			dragState.isDown = true;
			$window.addClass("dragging");
			$window.data("is-dragging", true); // Flag to prevent routing during drag

			// Check if page is in RTL mode
			const isRTL = $("html").attr("dir") === "rtl" || getComputedStyle(document.documentElement).direction === "rtl";

			// Store whether we're using left or right property
			const windowLeft = parseFloat($window.css("left")) || $window.offset().left;

			dragState.offset = [
				windowLeft - e.clientX,
				$window.offset().top - e.clientY
			];
			dragState.isRTL = isRTL;

			// Bring to front by incrementing z-index
			self.window_z_index += 1;
			$window.css("z-index", self.window_z_index);

			// Show snap guides when starting drag
			self.show_snap_guides();

			//  Prevent any selection or default behavior during drag
			e.preventDefault();
		});

		const windowMoveHandler = (e) => {
			if (dragState.isDown) {
				const newLeft = e.clientX + dragState.offset[0];
				const newTop = e.clientY + dragState.offset[1];

				// Constrain to viewport with some margin
				const maxLeft = $(window).width() - $window.outerWidth() + 100;
				const maxTop = $(window).height() - $window.outerHeight() + 100;

				const positionStyles = {
					top: Math.max(0, Math.min(newTop, maxTop)) + "px"
				};

				// In RTL mode, use right instead of left
				if (dragState.isRTL) {
					positionStyles.left = "auto";
					const rightValue = $(window).width() - (newLeft + $window.outerWidth());
					positionStyles.right = Math.max(-100, Math.min(rightValue, maxLeft)) + "px";
				} else {
					positionStyles.right = "auto";
					positionStyles.left = Math.max(-100, Math.min(newLeft, maxLeft)) + "px";
				}

				$window.css(positionStyles);

				// Check for snap regions during drag and update dragState
				dragState.snapRegion = self.check_snap_region(e.clientX);
			}
		};

		const windowUpHandler = (e) => {
			if (dragState.isDown) {
				dragState.isDown = false;
				$window.removeClass("dragging");
				$window.data("is-dragging", false); // Clear drag flag

				// Check if dropped in a snap region
				if (dragState.snapRegion) {
					self.snap_window($window, dragState.snapRegion);
					dragState.snapRegion = null;
				}

				// Hide snap guides after drop
				self.hide_snap_guides();
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
		let current_page = pages.filter((p) => p.name == page.name)[0];  // Filter by internal workspace name
		this._page = current_page;
		this.content = current_page && JSON.parse(current_page.content);

		if (this.content) {
			this.add_custom_cards_in_content();
		}

		// Always fetch fresh data from server (no caching)
		frappe.after_ajax(() => this.get_data(current_page)).then(() => {
			this.render_window_content(page, $window);
		});
	}

	render_window_content(page, $window) {
		const $content = $window.find(".window-content");
		
		// CRITICAL FIX: Save Deep Linked pages
		// Check if any pages were routed into this window while we were waiting for data
		const $preservedPages = $content.find(".window-page-view");
		if ($preservedPages.length > 0) {
			console.log(`[Workspace] Preserving ${$preservedPages.length} deep-linked pages before render`);
			$preservedPages.detach(); // Remove from DOM but keep state/events intact
		}

		// Now safe to clear
		$content.empty();

		// Create sidebar + main content layout
		const sidebar_html = `<div class="window-sidebar"></div>`;
		// Generate a safe ID that doesn't contain special characters
		const editor_id = `window-editor-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const main_html = `<div class="window-main">
			<div id="${editor_id}" class="desk-page page-main-content" style="padding: 15px;"></div>
		</div>`;

		$content.html(sidebar_html + main_html);

		// Build the sidebar with shortcuts
		this.build_window_sidebar($window, page);

		// Initialize editor for this window
		this.initialize_window_editor(editor_id, this.content);

		// Store editor reference for this window
		$window.data("workspace-editor", this.editor);

		// CRITICAL FIX: Restore Deep Linked pages
		if ($preservedPages.length > 0) {
			$content.append($preservedPages);
			
			// Since we have an active page view, we must HIDE the workspace blocks we just rendered
			$content.find(".window-main").hide();
			
			// Ensure the preserved page is visible
			$preservedPages.show();
			console.log(`[Workspace] Restored deep-linked pages`);
		}

		// Setup routing interception only once (if not done in constructor)
		if (!frappe.views.Container.prototype._workspace_routing_setup) {
			// fallback check
			this.setup_window_routing();
		}
	}

	build_window_sidebar($window, page) {
		const self = this;
		const $sidebar = $window.find(".window-sidebar");
		$sidebar.empty();
		$sidebar.html('<div class="sidebar-loading">Loading sidebar...</div>');

		// Get sidebar links from backend API (with permission filtering)
		frappe.call({
			method: "frappe.desk.desktop.get_user_sidebar_links",
			args: {
				workspace_name: page.name
			},
			callback: (r) => {
				if (r.message) {
					self.render_sidebar($window, page, r.message);
				} else {
					$sidebar.html('<div class="sidebar-empty"></div>');
				}
			},
			error: () => {
				$sidebar.html('<div class="sidebar-error">Failed to load sidebar</div>');
			}
		});
	}

	render_sidebar($window, page, sidebar_data) {
		const $sidebar = $window.find(".window-sidebar");
		$sidebar.empty();

		const links = sidebar_data.links || [];
		const is_customized = sidebar_data.is_customized || false;

		if (links.length === 0) {
			$sidebar.html('<div class="sidebar-empty"></div>');
			return;
		}

		// Create sidebar header (no separate edit button - use window edit button instead)
		const display_title = page.title || page.name;  // Use user-friendly title if available
		const header_html = `
			<div class="sidebar-header">
				<h5>${display_title}</h5>
			</div>
		`;
		$sidebar.append(header_html);

		// Create sidebar Home link (root of workspace)
		const home_link_html = `
			<div class="sidebar-home-link sidebar-link" data-is-home="true" title="Home">
				<svg class="icon icon-sm sidebar-link-icon">
					<use href="#icon-home"></use>
				</svg>
				<span class="sidebar-link-label">Home</span>
			</div>
		`;
		$sidebar.append(home_link_html);

		// Create sidebar links container
		const $links_container = $('<div class="sidebar-links"></div>');
		// Group links by categories
		let current_category = null;
		let $current_category_group = null;

		links.forEach((link, index) => {
			// Handle Category links
			if (link.link_type === 'Category') {
				const icon = link.icon || 'folder';
				const label = link.label || 'Category';
				const category_id = `category-${frappe.router.slug(label)}-${index}`;

				const is_draggable_class = !page.public ? 'is-draggable' : '';

				// Create category header with collapse toggle
				const category_html = `
					<div class="sidebar-category sidebar-link ${is_draggable_class}" 
						data-link-type="Category"
						data-label="${frappe.utils.escape_html(label)}"
						data-icon="${icon}"
						data-category-id="${category_id}">
						<div class="sidebar-category-header" data-toggle="${category_id}">
							<div class="drag-handle">
								<svg class="icon icon-xs">
									<use href="#icon-drag"></use>
								</svg>
							</div>
							<svg class="icon icon-sm sidebar-category-icon">
								<use href="#icon-${icon}"></use>
							</svg>
							<span class="sidebar-category-label">${label}</span>
							<svg class="icon icon-xs sidebar-category-toggle">
								<use href="#es-line-down"></use>
							</svg>
						</div>
						<div class="sidebar-category-items" id="${category_id}"></div>
					</div>
				`;

				$links_container.append(category_html);
				current_category = category_id;
				$current_category_group = $links_container.find(`#${category_id}`);
				return;
			}

			// Skip invalid links (but Category links have no link_to)
			if (!link.link_to) {
				return;
			}

			const icon = link.icon || 'file';
			const label = link.label || link.link_to;
			// Create unique ID for this link
			const link_id = `${link.link_type}-${frappe.router.slug(link.link_to)}`;

			// Determine the route based on link type and doc_view
			let route = '';
			const doctype_slug = frappe.router.slug(link.link_to);

			if (link.link_type === 'DocType') {
				if (link.doc_view) {
					// Use the specified view
					switch (link.doc_view) {
						case "List":
							route = `/app/${doctype_slug}/view/list`;
							break;
						case "Tree":
							route = `/app/${doctype_slug}/view/tree`;
							break;
						case "Report Builder":
							route = `/app/${doctype_slug}/view/report`;
							break;
						case "Dashboard":
							route = `/app/${doctype_slug}/view/dashboard`;
							break;
						case "New":
							route = `/app/${doctype_slug}/new`;
							break;
						case "Calendar":
							route = `/app/${doctype_slug}/view/calendar/default`;
							break;
						case "Kanban":
							route = `/app/${doctype_slug}/view/kanban`;
							if (link.kanban_board) {
								route += `/${link.kanban_board}`;
							}
							break;
						default:
							route = `/app/${doctype_slug}`;
					}
				} else {
					// Default to list view
					route = `/app/${doctype_slug}`;
				}
			} else if (link.link_type === 'Page') {
				route = `/app/${doctype_slug}`;
			} else if (link.link_type === 'Report') {
				route = `/app/query-report/${doctype_slug}`;
			} else if (link.link_type === 'URL') {
				route = link.link_to; // Direct URL
			} else {
				route = `/app/${doctype_slug}`;
			}

			const is_custom_class = link.is_custom ? 'is-custom-link' : '';
			const is_draggable_class = !page.public ? 'is-draggable' : '';
			const is_default_class = link.is_default ? 'is-default-link' : '';

			const link_html = `
				<div class="sidebar-link ${is_draggable_class} ${is_custom_class} ${is_default_class}"
				     data-link-id="${link_id}"
				     data-route="${route}"
				     data-link-to="${link.link_to}"
				     data-link-type="${link.link_type}"
				     data-label="${frappe.utils.escape_html(label)}"
				     data-icon="${icon}"
				     data-is-custom="${link.is_custom ? 1 : 0}"
				     data-is-default="${link.is_default ? 1 : 0}"
				     data-doc-view="${link.doc_view || ''}"
				     data-kanban-board="${link.kanban_board || ''}"
				     data-color="${link.color || ''}"
				     data-stats-filter="${(link.stats_filter || '').replace(/"/g, '&quot;')}">
					<div class="drag-handle">
						<svg class="icon icon-xs">
							<use href="#icon-drag"></use>
						</svg>
					</div>
					<svg class="icon icon-sm sidebar-link-icon">
						<use href="#icon-${icon}"></use>
					</svg>
					<span class="sidebar-link-label">${label}</span>
				</div>
			`;

			// Append to category group if exists, otherwise to main container
			if ($current_category_group) {
				$current_category_group.append(link_html);
			} else {
				$links_container.append(link_html);
			}
		});

		$sidebar.append($links_container);

		// Store sidebar metadata on window
		$window.data("sidebar-customized", is_customized);
		$window.data("sidebar-links", links);

		// Load and apply localStorage saved order (for drag-drop Phase 2)
		// const saved_order = this.load_sidebar_order($window, page);
		// if (saved_order) {
		// 	this.apply_sidebar_order($window, saved_order);
		// }

		// Add click handlers for sidebar links
		this.setup_sidebar_navigation($window);

		// Render count badges for sidebar links
		this.render_sidebar_count_badges($window);

		// Enable drag-and-drop reordering
		this.setup_sidebar_sortable($window, page);

		// Setup handlers for default link checkbox in edit mode
		this.setup_default_link_handlers($window);

		// Navigate to default link if set
		this.navigate_to_default_link($window);

		// Edit mode is now controlled by the main window edit button
	}

	setup_sidebar_navigation($window) {
		const self = this;

		$window.find(".sidebar-link").off("click").on("click", function(e) {
			// Don't navigate if clicking on drag handle
			if ($(e.target).closest(".drag-handle").length > 0) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			const $link = $(this);

			// Handle Home link specially
			if ($link.data("is-home")) {
				// Set this window as active
				self.active_workspace_window = $window;
				$window.data("is-active", true);

				// Clear the route stack since Home is the root
				$window.data("route-stack", []);
				console.log("[Home Link] Cleared route stack for workspace");

				// Remove active class from all links
				$window.find(".sidebar-link").removeClass("active");

				// Mark Home link as active
				$link.addClass("active");

				// Clear any stored page
				$window.data("current-page", null);
				$window.data("workspace-active-page", null);

				// Show workspace content instead of navigating
				const $content = $window.find(".window-content");
				$content.find(".window-page-view").hide();
				$content.find(".desk-page").show();
				$content.find(".window-main").show();

				// Hide back button since we're at root
				$window.find(".btn-window-back").hide();

				// Clear breadcrumb
				$window.find(".breadcrumb-trail").html("");

				// Navigate to workspace route
				const workspacePage = $window.data("workspace-link");
				if (workspacePage) {
					frappe.set_route(workspacePage);
				}

				return;
			}

			// Regular link navigation
			const route = $link.data("route");

			if (!route) return;

			// Apply stats_filter as route options if present
			const stats_filter = $link.data("stats-filter");
			if (stats_filter) {
				try {
					const filters = frappe.utils.get_filter_from_json(stats_filter, $link.data("link-to"));
					if (filters && Array.isArray(filters) && filters.length > 0) {
						frappe.route_options = filters;
					}
				} catch(e) {
					console.warn("Invalid stats_filter JSON:", stats_filter, e);
				}
			}

			// Set this window as active before navigation
			self.active_workspace_window = $window;
			$window.data("is-active", true);

			// Remove active class from all links in this window
			$window.find(".sidebar-link").removeClass("active");

			// Add active class to clicked link
			$link.addClass("active");

			// Store current active route in window data
			$window.data("current-route", route);

			// Navigate using frappe router
			frappe.set_route(route);
		});

		// Setup category collapse/expand functionality
		$window.find(".sidebar-category-header").off("click").on("click", function(e) {
			// Don't collapse if clicking on drag handle
			if ($(e.target).closest(".drag-handle").length > 0) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			const $header = $(this);
			const $category = $header.closest(".sidebar-category");
			const $items = $category.find(".sidebar-category-items");
			const $toggle = $header.find(".sidebar-category-toggle");

			// Toggle collapsed state
			$category.toggleClass("collapsed");

			// Rotate chevron icon
			if ($category.hasClass("collapsed")) {
				$toggle.css("transform", "rotate(-90deg)");
				$items.slideUp(200);
			} else {
				$toggle.css("transform", "rotate(0deg)");
				$items.slideDown(200);
			}
		});
	}

	render_sidebar_count_badges($window) {
		/**
		 * Render count badges for sidebar links with stats_filter
		 * Displays count next to link label with optional color styling
		 */
		const $links = $window.find(".sidebar-link");

		$links.each((index, link_element) => {
			const $link = $(link_element);
			const link_type = $link.data("link-type");
			const link_to = $link.data("link-to");
			const doc_view = $link.data("doc-view");
			const stats_filter = $link.data("stats-filter");
			const color = $link.data("color");

			// Only show count badges for DocType links with stats_filter
			if (link_type !== 'DocType' || doc_view === 'New' || !stats_filter) {
				return;
			}

			// Parse filter and execute count query
			try {
				const filters = frappe.utils.process_filter_expression(stats_filter);
				if (!filters) return;

				frappe.db.count(link_to, { filters: filters })
					.then((count) => {
						// Determine color (default to gray if no color or count is 0)
						let badge_color = 'gray';
						if (color && count > 0) {
							badge_color = color.toLowerCase();
						}

						// Create and append count badge
						const $count_badge = $(
							`<div class="indicator-pill no-indicator-dot ${badge_color}">${count}</div>`
						);

						const $label = $link.find('.sidebar-link-label');
						if ($label.length) {
							$count_badge.insertAfter($label);
						}
					})
					.catch((error) => {
						console.warn("Error fetching count for " + link_to, error);
					});
			} catch(e) {
				console.warn("Invalid stats_filter for " + link_to, stats_filter, e);
			}
		});
	}

	navigate_to_default_link($window) {
		/**
		 * Navigate to the default link for the workspace
		 * Finds the link marked with is_default = true and navigates to it
		 * Only navigates on first sidebar load
		 */
		const self = this;

		// CRITICAL FIX: Skip if this window was opened via deep link/awesome bar
		if ($window.data("is-deep-linking")) {
			console.log("[Default Link Navigation] Skipping - Deep linking in progress");
			return;
		}

		// Check if we're processing a deep link from page refresh/initialization
		// If so, skip default link navigation to avoid overriding the deep link
		if (this.deep_link_processed_on_init) {
			console.log("[Default Link Navigation] Skipping - deep link was processed on init");
			return;
		}

		// Check if there's a pending deep link being processed
		if (frappe.workspace_deep_link && frappe.workspace_deep_link.pending_deep_link) {
			console.log("[Default Link Navigation] Skipping - pending deep link exists");
			return;
		}

		// FIXED: Check if awesome bar selection is in progress
		// If so, skip default link navigation to avoid overriding the awesome bar selection
		if ($window.data("awesomebar-selection-in-progress")) {
			console.log("[Default Link Navigation] Skipping - awesome bar selection in progress");
			return;
		}

		// Check if navigation is already in progress for this window
		const navigationInProgress = $window.data("default-link-navigation-in-progress");
		if (navigationInProgress) {
			console.log("[Default Link Navigation] Navigation already in progress, skipping");
			return;
		}

		// Find the link marked as default
		const $defaultLink = $window.find(".sidebar-link.is-default-link").first();

		console.log("[Default Link Navigation] Looking for default link, found:", $defaultLink.length > 0);

		if ($defaultLink.length) {
			// Get the route from the data attribute
			const route = $defaultLink.data("route");

			console.log("[Default Link Navigation] Default link route:", route);

			if (route) {
				// Mark navigation as in progress
				$window.data("default-link-navigation-in-progress", true);

				// Use setTimeout to ensure navigation happens after DOM is fully ready
				// and click handlers are attached
				setTimeout(() => {
					console.log("[Default Link Navigation] Navigating to default link route:", route);

					// Set this window as active
					self.active_workspace_window = $window;
					$window.data("is-active", true);

					// Remove active class from all links
					$window.find(".sidebar-link").removeClass("active");

					// Add active class to default link
					$defaultLink.addClass("active");

					// Store current route
					$window.data("current-route", route);

					// Navigate using frappe router
					frappe.set_route(route);
				}, 150);
			}
		}
	}

	setup_default_link_handlers($window) {
		/**
		 * Setup handlers for is_default checkbox in edit mode
		 * When one link is marked as default, uncheck all others
		 */
		const self = this;
		const $linksContainer = $window.find(".sidebar-links");

		// Handle checkbox changes in edit mode
		$linksContainer.on("change", ".is-default-checkbox", function() {
			const $checkbox = $(this);
			const $link = $checkbox.closest(".sidebar-link");
			const isDefault = $checkbox.is(":checked");

			if (isDefault) {
				// Uncheck all other links
				$linksContainer.find(".sidebar-link").each(function() {
					if (this !== $link[0]) {
						$(this).removeClass("is-default-link").attr("data-is-default", "0");
						const $otherCheckbox = $(this).find(".is-default-checkbox");
						if ($otherCheckbox.length) {
							$otherCheckbox.prop("checked", false);
						}
					}
				});
				$link.addClass("is-default-link").attr("data-is-default", "1");
			} else {
				$link.removeClass("is-default-link").attr("data-is-default", "0");
			}
		});
	}

	setup_sidebar_sortable($window, page) {
		const self = this;
		const $linksContainer = $window.find(".sidebar-links");

		// Skip sortable setup for public workspaces (sidebar is not customizable)
		if (page.public || !$linksContainer.length) return;

		// Store sortable instances for proper cleanup
		const sortableInstances = [];

		// Initialize Sortable.js for main container - supports both sidebar-link and sidebar-category elements
		const mainSortable = new Sortable($linksContainer[0], {
			handle: ".drag-handle",
			draggable: ".sidebar-link.is-draggable, .sidebar-category.is-draggable",
			animation: 150,
			ghostClass: "sortable-ghost",
			chosenClass: "sortable-chosen",
			dragClass: "sortable-drag",
			group: "workspace-sidebar",

			onEnd: function(evt) {
				// Save the new order after drag completes
				self.save_sidebar_order($window, page);
			}
		});
		sortableInstances.push(mainSortable);

		// Initialize Sortable.js for category items containers - allow dragging items in/out
		$linksContainer.find(".sidebar-category-items").each(function() {
			const categorySortable = new Sortable(this, {
				handle: ".drag-handle",
				draggable: ".sidebar-link.is-draggable",
				animation: 150,
				ghostClass: "sortable-ghost",
				chosenClass: "sortable-chosen",
				dragClass: "sortable-drag",
				group: "workspace-sidebar",

				onEnd: function(evt) {
					// Save the new order after drag completes
					self.save_sidebar_order($window, page);
				}
			});
			sortableInstances.push(categorySortable);
		});

		// Store for cleanup
		$window.data("sidebar-sortables", sortableInstances);
	}

	// === DESTROY SIDEBAR SORTABLES ===
	destroy_sidebar_sortables($window) {
		const sortableInstances = $window.data("sidebar-sortables");
		if (sortableInstances && Array.isArray(sortableInstances)) {
			sortableInstances.forEach(sortable => {
				try {
					if (sortable && typeof sortable.destroy === 'function') {
						sortable.destroy();
					}
				} catch (e) {
					console.warn("Error destroying sidebar sortable:", e);
				}
			});
		}
		$window.removeData("sidebar-sortables");
	}

	save_sidebar_order($window, page) {
		const sidebar_data = $window.data("sidebar-links");
		if (!sidebar_data || !Array.isArray(sidebar_data)) {
			return;
		}

		const $linksContainer = $window.find(".sidebar-links");
		const new_order = [];
		const idToLinkMap = {};

		// Create a map of current links for quick lookup
		sidebar_data.forEach((link, index) => {
			if (link.link_type === "Category") {
				idToLinkMap[`category-${link.label}`] = { ...link };
			} else {
				idToLinkMap[`${link.link_type}-${link.link_to}`] = { ...link };
			}
		});

		let global_idx = 1;

		// Collect current order from DOM - process both categories and links at root level
		$linksContainer.children().each(function(index) {
			const $elem = $(this);

			if ($elem.hasClass("sidebar-category")) {
				// It's a category
				const label = $elem.find(".sidebar-category-label").text();
				let link_data = idToLinkMap[`category-${label}`];
				if (!link_data) {
					link_data = {
						link_type: "Category",
						label: label,
						icon: $elem.find(".sidebar-category-icon").attr("data-icon") || "folder"
					};
				}
				link_data.idx = global_idx;
				new_order.push(link_data);
				global_idx++;

				// Also collect links inside this category
				$elem.find(".sidebar-category-items .sidebar-link.is-draggable").each(function() {
					const $link = $(this);
					const link_type = $link.data("link-type");
					const link_to = $link.data("link-to");
					let link_item = idToLinkMap[`${link_type}-${link_to}`];
					if (!link_item) {
						link_item = {
							link_type: link_type,
							link_to: link_to,
							label: $link.data("label"),
							icon: $link.data("icon"),
							is_custom: $link.data("is-custom"),
							is_default: $link.data("is-default"),
							doc_view: $link.data("doc-view"),
							kanban_board: $link.data("kanban-board"),
							color: $link.data("color"),
							stats_filter: $link.data("stats-filter")
						};
					}
					link_item.idx = global_idx;
					new_order.push(link_item);
					global_idx++;
				});
			} else if ($elem.hasClass("sidebar-link")) {
				// It's a regular link at root level (not inside a category)
				const link_type = $elem.data("link-type");
				const link_to = $elem.data("link-to");
				let link_data = idToLinkMap[`${link_type}-${link_to}`];
				if (!link_data) {
					link_data = {
						link_type: link_type,
						link_to: link_to,
						label: $elem.data("label"),
						icon: $elem.data("icon"),
						is_custom: $elem.data("is-custom"),
						is_default: $elem.data("is-default"),
						doc_view: $elem.data("doc-view"),
						kanban_board: $elem.data("kanban-board"),
						color: $elem.data("color"),
						stats_filter: $elem.data("stats-filter")
					};
				}
				link_data.idx = global_idx;
				new_order.push(link_data);
				global_idx++;
			}
		});

		// Call backend to save the new order
		frappe.call({
			method: "frappe.desk.doctype.workspace_user_sidebar.workspace_user_sidebar.update_sidebar_links_order",
			args: {
				workspace: page.name,
				links_order: new_order
			},
			callback: function(r) {
				if (!r.exc) {
					// Update the cached sidebar data
					$window.data("sidebar-links", new_order);
					frappe.show_alert({
						message: __("Sidebar order saved"),
						indicator: "green"
					}, 2);
				}
			},
			error: function() {
				frappe.show_alert({
					message: __("Failed to save sidebar order"),
					indicator: "red"
				}, 2);
			}
		});
	}

	// ======================================
	// Edit Sidebar Mode (Phase 3)
	// ======================================

	setup_edit_sidebar_button($window, page) {
		const self = this;
		$window.find(".btn-edit-sidebar").off("click").on("click", function() {
			self.enter_sidebar_edit_mode($window, page);
		});
	}

	enter_sidebar_edit_mode($window, page) {
		const $sidebar = $window.find(".window-sidebar");
		const display_title = page.title || page.name;  // Use user-friendly title

		// Add edit mode class
		$sidebar.addClass("edit-mode");

		// Check if sidebar has proper structure
		const hasHeader = $sidebar.find(".sidebar-header").length > 0;
		const hasLinksContainer = $sidebar.find(".sidebar-links").length > 0;

		// If sidebar is empty, rebuild it with proper structure
		if (!hasHeader || !hasLinksContainer) {
			$sidebar.empty();

			// Add header with edit controls
			const header_html = `
				<div class="sidebar-header edit-mode-header">
					<h5>${display_title} - Edit</h5>
					<div class="edit-controls">
						<button class="btn btn-xs btn-add-link" title="Add Link">
							<svg class="icon icon-xs"><use href="#icon-add"></use></svg>
						</button>
						<button class="btn btn-xs btn-save-sidebar" title="Save">
							<svg class="icon icon-xs"><use href="#icon-save"></use></svg>
						</button>
						<button class="btn btn-xs btn-reset-sidebar" title="Reset">
							<svg class="icon icon-xs"><use href="#icon-refresh"></use></svg>
						</button>
						<button class="btn btn-xs btn-cancel-edit" title="Cancel">
							<svg class="icon icon-xs"><use href="#icon-close"></use></svg>
						</button>
					</div>
				</div>
			`;
			$sidebar.append(header_html);

			// Add empty links container
			$sidebar.append('<div class="sidebar-links"><div class="sidebar-empty">No links yet. Click Add to create one.</div></div>');
		} else {
			// Replace existing header with edit controls
			const header_html = `
				<div class="sidebar-header edit-mode-header">
					<h5>${display_title} - Edit</h5>
					<div class="edit-controls">
						<button class="btn btn-xs btn-add-link" title="Add Link">
							<svg class="icon icon-xs"><use href="#icon-add"></use></svg>
						</button>
						<button class="btn btn-xs btn-save-sidebar" title="Save">
							<svg class="icon icon-xs"><use href="#icon-save"></use></svg>
						</button>
						<button class="btn btn-xs btn-reset-sidebar" title="Reset">
							<svg class="icon icon-xs"><use href="#icon-refresh"></use></svg>
						</button>
						<button class="btn btn-xs btn-cancel-edit" title="Cancel">
							<svg class="icon icon-xs"><use href="#icon-close"></use></svg>
						</button>
					</div>
				</div>
			`;
			$sidebar.find(".sidebar-header").replaceWith(header_html);

			// Add remove buttons to each link
			$sidebar.find(".sidebar-link").each(function() {
				const $link = $(this);
				if (!$link.find(".btn-remove-link").length) {
					$link.append(`
						<button class="btn-remove-link" title="Remove">
							<svg class="icon icon-xs"><use href="#icon-close"></use></svg>
						</button>
					`);
				}
			});
		}

		// Setup edit mode handlers
		this.setup_edit_mode_handlers($window, page);
	}

	setup_edit_mode_handlers($window, page) {
		const self = this;

		// Add link button
		$window.find(".btn-add-link").off("click").on("click", function() {
			self.show_add_link_dialog($window, page);
		});

		// Save button
		$window.find(".btn-save-sidebar").off("click").on("click", function() {
			self.save_sidebar_customizations($window, page);
		});

		// Reset button
		$window.find(".btn-reset-sidebar").off("click").on("click", function() {
			self.reset_sidebar_customizations($window, page);
		});

		// Cancel button
		$window.find(".btn-cancel-edit").off("click").on("click", function() {
			self.exit_sidebar_edit_mode($window, page);
		});

		// Remove link buttons
		$window.find(".btn-remove-link").off("click").on("click", function(e) {
			e.stopPropagation();
			$(this).closest(".sidebar-link").remove();
		});
	}

	exit_sidebar_edit_mode($window, page) {
		// Reload sidebar to revert changes
		this.build_window_sidebar($window, page);
	}

	save_sidebar_customizations($window, page) {
		const links = [];
		
		// Collect all links from DOM
		$window.find(".sidebar-link:not(.sidebar-home-link)").each(function() {
			const $link = $(this);
			links.push({
				link_type: $link.data("link-type"),
				link_to: $link.data("link-to"),
				label: $link.data("label"),
				icon: $link.data("icon"),
				is_custom: $link.data("is-custom") ? 1 : 0,
				is_default: $link.data("is-default") ? 1 : 0,
				doc_view: $link.data("doc-view") || null,
				kanban_board: $link.data("kanban-board") || null,
				color: $link.data("color") || null,
				stats_filter: $link.data("stats-filter") || null
			});
		});
		
		// Save to backend
		frappe.call({
			method: "frappe.desk.desktop.save_user_sidebar",
			args: {
				workspace_name: page.name,
				links: links,
				hidden_links: []
			},
			callback: (r) => {
				if (r.message && r.message.success) {
					frappe.show_alert({
						message: r.message.message,
						indicator: "green"
					});
					// Reload sidebar
					// this.build_window_sidebar($window, page);
					window.location.reload(true)
				}
			},
			error: () => {
				frappe.show_alert({
					message: __("Failed to save sidebar customizations"),
					indicator: "red"
				});
			}
		});
	}

	reset_sidebar_customizations($window, page) {
		frappe.confirm(
			__("Are you sure you want to reset sidebar to default?"),
			() => {
				frappe.call({
					method: "frappe.desk.desktop.reset_user_sidebar",
					args: {
						workspace_name: page.name
					},
					callback: (r) => {
						if (r.message && r.message.success) {
							frappe.show_alert({
								message: r.message.message,
								indicator: "green"
							});
							// Reload sidebar
							this.build_window_sidebar($window, page);
						}
					}// .bind(this)
				});
			}
		);
	}

	show_add_link_dialog($window, page) {
		const self = this;
		// Get permitted link options from backend
		frappe.call({
			method: "frappe.desk.desktop.get_permitted_link_options",
			freeze: true,
    		freeze_message: "Loading...",
			callback: (r) => {
				if (r.message) {
					self.render_add_link_dialog($window, page, r.message);
				}
			}
		});
	}

	render_add_link_dialog($window, page, options) {
		const self = this;

		const dialog = new frappe.ui.Dialog({
			title: __("Add Link to Sidebar"),
			fields: [
				{
					fieldname: "link_type",
					fieldtype: "Select",
					label: __("Link Type"),
					options: ["DocType", "Page", "Report", "URL","Category"],
					reqd: 1,
					onchange: function() {
						const link_type = this.get_value();
						const is_category = link_type === "Category";
						const is_url = link_type === "URL";

						// Show/hide link_to field
						dialog.get_field("link_to").df.hidden = is_category || is_url;
						dialog.get_field("link_to").df.reqd = !is_category && !is_url;

						// Show/hide URL field
						dialog.get_field("url").df.hidden = !is_url;
						dialog.get_field("url").df.reqd = is_url;

						// Show/hide is_default field (Categories cannot be default)
						dialog.get_field("is_default").df.hidden = is_category;
						if (is_category) {
							dialog.set_value("is_default", 0);
						}

						// Show/hide section_view and related fields
						dialog.get_field("section_view").df.hidden = is_category;
						dialog.get_field("doc_view").df.hidden = is_category;
						dialog.get_field("kanban_board").df.hidden = is_category;

						// Show/hide section_count and related fields
						dialog.get_field("section_count").df.hidden = is_category;
						dialog.get_field("stats_filter").df.hidden = is_category;
						dialog.get_field("color").df.hidden = is_category;

						dialog.refresh();
					}
				},
				{
					fieldname: "link_to",
					fieldtype: "Autocomplete",
					label: __("Link To"),
					options: [],
					reqd: 1
				},
				{
					fieldname: "url",
					fieldtype: "Data",
					label: __("URL"),
					hidden: 1
				},
				{
					fieldname: "label",
					fieldtype: "Data",
					label: __("Label"),
					reqd: 1
				},
				{
					fieldname: "icon",
					fieldtype: "Icon",
					label: __("Icon"),
					default: "file"
				},
				{
					fieldname: "is_default",
					fieldtype: "Check",
					label: __("Is Default Link"),
					default: 0,
					description: __("Check to make this the default link that opens when workspace is accessed")
				},
				{
					fieldname: "section_view",
					fieldtype: "Section Break",
					label: __("DocType View")
				},
				{
					fieldname: "doc_view",
					fieldtype: "Select",
					label: __("DocType View"),
					options: ["", "List", "Report Builder", "Dashboard", "Tree", "New", "Calendar", "Kanban"],
					depends_on: "eval: doc.link_type === 'DocType'",
					description: __("Which view of the DocType should this link open?"),
					onchange: function() {
						const doc_view = this.get_value();
						const kanban_field = dialog.get_field("kanban_board");
						if (doc_view === "Kanban") {
							kanban_field.df.hidden = 0;
							kanban_field.df.reqd = 1;
						} else {
							kanban_field.df.hidden = 1;
							kanban_field.df.reqd = 0;
						}
						dialog.refresh();
					}
				},
				{
					fieldname: "kanban_board",
					fieldtype: "Link",
					label: __("Kanban Board"),
					options: "Kanban Board",
					depends_on: "eval: doc.doc_view === 'Kanban'",
					hidden: 1,
					get_query: function() {
						const link_to = dialog.get_value("link_to");
						return {
							filters: {
								reference_doctype: link_to
							}
						};
					}
				},
				{
					fieldname: "section_count",
					fieldtype: "Section Break",
					label: __("Count Customization")
				},
				{
					fieldname: "stats_filter",
					fieldtype: "Code",
					label: __("Count Filter"),
					options: "JSON",
					description: __("JSON filter to display count badge. Example: [[\"Task\",\"status\",\"=\",\"Open\"]]")
				},
				{
					fieldname: "color",
					fieldtype: "Color",
					label: __("Color"),
					description: __("Color for the count badge when count > 0")
				}
			],
			primary_action_label: __("Add"),
			primary_action: (values) => {
				// Validate that Category links have label and icon
				if (values.link_type === "Category") {
					if (!values.label) {
						frappe.msgprint(__("Label is required for Category links"));
						return;
					}
					if (!values.icon) {
						frappe.msgprint(__("Icon is required for Category links"));
						return;
					}
				}
				self.add_link_to_sidebar($window, page, values);
				dialog.hide();
			}
		});

		// Setup autocomplete options based on link type
		dialog.fields_dict.link_type.$input.on("change", function() {
			const link_type = dialog.get_value("link_type");
			let autocomplete_options = [];

			if (link_type === "DocType") {
				autocomplete_options = options.doctypes.map(d => d.value);
			} else if (link_type === "Page") {
				autocomplete_options = options.pages.map(p => p.value);
			} else if (link_type === "Report") {
				autocomplete_options = options.reports.map(r => r.value);
			}

			dialog.fields_dict.link_to.set_data(autocomplete_options);
		});

		dialog.show();
	}

	add_link_to_sidebar($window, page, values) {
		const $links_container = $window.find(".sidebar-links");

		// If marking this link as default, uncheck others (skip for Category)
		if (values.is_default && values.link_type !== "Category") {
			$links_container.find(".sidebar-link").each(function() {
				$(this).removeClass("is-default-link").attr("data-is-default", "0");
			});
		}

		// Handle Category links differently
		if (values.link_type === "Category") { 
			const category_id = `category-${frappe.router.slug(values.label)}-${Date.now()}`;
			const category_html = `
				<div class="sidebar-category sidebar-link is-draggable"
					data-link-type="Category"
					data-label="${frappe.utils.escape_html(values.label)}"
					data-icon="${values.icon}"
					data-link-type="Category" data-category-id="${category_id}">
					<div class="sidebar-category-header" data-toggle="${category_id}">
						<div class="drag-handle">
							<svg class="icon icon-xs"><use href="#icon-drag"></use></svg>
						</div>
						<svg class="icon icon-sm sidebar-category-icon">
							<use href="#icon-${values.icon}"></use>
						</svg>
						<span class="sidebar-link-label">${frappe.utils.escape_html(values.label)}</span>
						<svg class="icon icon-xs sidebar-category-toggle">
							<use href="#es-line-down"></use>
						</svg>
					</div>
				</div>
			`;

			const $category = $(category_html);
			$links_container.append($category);

			
			return;
		}

		const link_to = values.link_type === "URL" ? values.url : values.link_to;
		const link_id = `${values.link_type}-${frappe.router.slug(link_to)}`;

		// Determine route based on doc_view
		let route = link_to;
		if (values.link_type === 'DocType' && values.doc_view) {
			const doctype_slug = frappe.router.slug(link_to);
			switch (values.doc_view) {
				case "List":
					route = `/app/${doctype_slug}/view/list`;
					break;
				case "Tree":
					route = `/app/${doctype_slug}/view/tree`;
					break;
				case "Report Builder":
					route = `/app/${doctype_slug}/view/report`;
					break;
				case "Dashboard":
					route = `/app/${doctype_slug}/view/dashboard`;
					break;
				case "New":
					route = `/app/${doctype_slug}/new`;
					break;
				case "Calendar":
					route = `/app/${doctype_slug}/view/calendar/default`;
					break;
				case "Kanban":
					route = `/app/${doctype_slug}/view/kanban`;
					if (values.kanban_board) {
						route += `/${values.kanban_board}`;
					}
					break;
				default:
					route = `/app/${doctype_slug}`;
			}
		} else if (values.link_type === 'DocType') {
			route = `/app/${frappe.router.slug(link_to)}`;
		} else if (values.link_type === 'Page') {
			route = `/app/${frappe.router.slug(link_to)}`;
		} else if (values.link_type === 'Report') {
			route = `/app/query-report/${frappe.router.slug(link_to)}`;
		}

		// Create link HTML with new fields
		const is_default_class = values.is_default ? 'is-default-link' : '';
		const link_html = `
			<div class="sidebar-link is-draggable is-custom-link ${is_default_class}"
			     data-link-id="${link_id}"
			     data-route="${route}"
			     data-link-to="${link_to}"
			     data-link-type="${values.link_type}"
			     data-label="${frappe.utils.escape_html(values.label)}"
			     data-icon="${values.icon}"
			     data-is-custom="1"
			     data-is-default="${values.is_default ? 1 : 0}"
			     data-doc-view="${values.doc_view || ''}"
			     data-kanban-board="${values.kanban_board || ''}"
			     data-color="${values.color || ''}"
			     data-stats-filter="${(values.stats_filter || '').replace(/"/g, '&quot;')}">
				<div class="drag-handle">
					<svg class="icon icon-xs"><use href="#icon-drag"></use></svg>
				</div>
				<svg class="icon icon-sm sidebar-link-icon">
					<use href="#icon-${values.icon}"></use>
				</svg>
				<span class="sidebar-link-label">${values.label}</span>
				<button class="btn-remove-link" title="Remove">
					<svg class="icon icon-xs"><use href="#icon-close"></use></svg>
				</button>
			</div>
		`;

		const $new_link = $(link_html);
		$links_container.append($new_link);

		// Setup remove handler for new link
		$new_link.find(".btn-remove-link").on("click", function(e) {
			e.stopPropagation();
			$new_link.remove();
		});

		frappe.show_alert({
			message: __("Link added. Click Save to persist changes."),
			indicator: "blue"
		});
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
			if (self.active_workspace_window && (self.active_workspace_window.is(":visible") || self.active_workspace_window.hasClass("restoring")) ) {
				console.log(`[Deep Link] Showing page in window instead of main view`);

			// FIXED: Clear awesome bar selection flag after page is shown
			// This allows default link navigation to work on subsequent window loads
			setTimeout(() => {
				if (self.active_workspace_window) {
					self.active_workspace_window.data("awesomebar-selection-in-progress", false);
				}
			}, 200);
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
		const isNavigatingBack = $window.data("is-navigating-back");

		// Only push if:
		// 1. Not currently navigating back (to avoid infinite loop)
		// 2. Route is different from the last route in stack
		if (!isNavigatingBack && (routeStack.length === 0 || routeStack[routeStack.length - 1] !== currentRoute)) {
			routeStack.push(currentRoute);
			$window.data("route-stack", routeStack);
			console.log(`[${workspaceName}] Pushed to stack: ${currentRoute}`);
			console.log(`[${workspaceName}] Stack:`, routeStack);
		}

		// === FRESH RENDER APPROACH (No Caching) ===
		// Step 1: Show loading spinner
		this.show_window_loading_spinner($window, `Loading ${label}...`);

		// Step 2: Destroy all existing page views (no more caching)
		this.destroy_window_page_views($window);

		// Step 3: Hide the workspace content (sidebar + main)
		$content.find(".desk-page").hide(); 
		// $content.find(".window-sidebar").hide();
		$content.find(".window-main").hide();

		// Step 4: Create fresh wrapper for the page
		const $pageWrapper = $(`<div class="window-page-view" data-page-label="${label}" style="width: 100%; height: 100%; overflow: auto;"></div>`);

		// Step 5: Move the actual page element to the window (not cloning)
		// This ensures all event handlers and Frappe functionality works
		$pageWrapper.append($page);
		$page.show().trigger('show');
		$content.append($pageWrapper);

		// Step 6: Hide loading spinner
		this.hide_window_loading_spinner($window);

		console.log(`[${workspaceName}] Fresh render page: ${label}`);

		// Update breadcrumb
		this.update_window_breadcrumb($window, label);

		// Show back button since we just added to history
		$window.find(".btn-window-back").show();

		// Store current page in window
		$window.data("current-page", page);
		$window.data("workspace-active-page", label);

		// Update sidebar active state
		this.update_sidebar_active_state($window);

		return page;
	}

	update_window_breadcrumb($window, page_label) {
		const $breadcrumb = $window.find(".breadcrumb-trail");
		const page = frappe.pages[page_label];
		const page_title = page?.label || page_label;

		$breadcrumb.html(` > ${page_title}`).show();
	}

	update_sidebar_active_state($window) {
		// --- START: MODIFIED SECTION ---

		// 1. Use Frappe's router as the source of truth, not the browser's location.
		// It's always in sync with the application's state, even during transitions.
		const currentRouteArray = frappe.get_route();
		const currentRoute = currentRouteArray.join('/').toLowerCase(); // e.g., "lead/view/list"
		const original_url_currentRoute = decodeURIComponent(window.location.pathname);
		
		const $content = $window.find(".window-content");
		const isOnWorkspaceRoot = !$content.find(".window-page-view").is(":visible");

		$window.find(".sidebar-link").removeClass("active");
		// This logic for the "Home" link is still correct.
		if (isOnWorkspaceRoot || currentRouteArray.length === 0) {
			$window.find(".sidebar-home-link").addClass("active");
			return;
		}

		$window.find(".sidebar-link:not(.sidebar-home-link)").each(function() {
			const $link = $(this);
			const originalLinkRoute = $link.data("route");
			const originak_linkRoute = $link.data("route");

			if (!originalLinkRoute) return;

			// 2. Normalize the link's stored route in the same way as before.
			const linkRoute = originalLinkRoute.replace(/^\/app\//, '').replace(/\/$/, '');
			// 3. The robust startsWith check will now work reliably.
			if (currentRoute.startsWith(linkRoute) || original_url_currentRoute === originak_linkRoute || original_url_currentRoute.startsWith(originak_linkRoute + '/')) {
				$link.addClass("active");
			}
		});

		// --- END: MODIFIED SECTION ---
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

		// Set flag to indicate we're navigating back
		// This prevents the route from being pushed to stack during the navigation process
		$window.data("is-navigating-back", true);

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
			const routeParts = previousRoute.replace('/app/', '').split('/').filter(p => p).map(p => decodeURIComponent(p));
			console.log(`[${workspaceName}] Navigating to:`, routeParts);
			frappe.set_route(routeParts);
			// Clear the flag after a short delay to allow the route to change
			setTimeout(() => {
				$window.data("is-navigating-back", false);
			}, 100);
			return;
		}

		// No history - show workspace content (back to Home/root)
		console.log(`[${workspaceName}] No more history - showing workspace (HOME)`);

		// Clear the navigating back flag
		$window.data("is-navigating-back", false);

		// Hide any page views (preserve them in cache instead of removing)
		$content.find(".window-page-view").hide();

		// Show workspace content
		$content.find(".desk-page,.window-main").show();

		// Hide back button (we're at root, can't go further back)
		$window.find(".btn-window-back").hide();

		// Clear breadcrumb
		$window.find(".breadcrumb-trail").html("");

		// Clear stored page
		$window.data("current-page", null);
		$window.data("workspace-active-page", null);

		// Clear sidebar active state and mark Home as active
		$window.find(".sidebar-link").removeClass("active");
		$window.find(".sidebar-home-link").addClass("active");

		// Navigate to workspace route
		
		const workspacePage = $window.data("workspace-page");
		if (workspacePage) {
			let workspaceNameOnly = $window.attr("data-workspace-name-only") || workspacePage.name;
			const isRTL = $("html").attr("dir") === "rtl" || getComputedStyle(document.documentElement).direction === "rtl";
			
			if (workspacePage.public && isRTL) {
				workspaceNameOnly = workspacePage.name;
			}
			// Use data-workspace-name-only for private workspaces to avoid email suffix issues
			
			const workspaceRouteParts = workspacePage.public
				? [frappe.router.slug(workspaceNameOnly)]
				: ['private', frappe.router.slug(workspaceNameOnly)];
			frappe.set_route(workspaceRouteParts);
		}
	}

	cleanup_window_pages($window) {
		// === DESTROY EDITORJS INSTANCE ===
		const editor = $window.data("workspace-editor");
		if (editor && typeof editor.destroy === 'function') {
			try {
				editor.destroy();
			} catch (e) {
				console.warn("Error destroying EditorJS:", e);
			}
			$window.removeData("workspace-editor");
		}

		// === DESTROY SORTABLE INSTANCES ===
		this.destroy_window_sortable($window);
		this.destroy_sidebar_sortables($window);

		const $content = $window.find(".window-content");

		// Detach all pages from window wrappers and move them back to the main body
		// This preserves the pages in frappe.pages for potential reuse
		$content.find(".window-page-view").each((index, wrapper) => {
			const $wrapper = $(wrapper);
			const $pages = $wrapper.find(".page-container");

			// Move pages back to main body (hidden)
			// IMPORTANT: Do NOT call .off() on page elements!
			// This would destroy Frappe's original event handlers (forms, lists, etc.)
			$pages.each((idx, page) => {
				const $page = $(page);
				$page.hide(); // Hide before moving
				$(document.body).append($page); // Move back to body
			});

			// Now remove the wrapper
			$wrapper.remove();
		});

		// Remove all event listeners attached to window elements
		// Window control buttons
		$window.find(".btn-window-close").off("click");
		$window.find(".btn-window-minimize").off("click");
		$window.find(".btn-window-maximize").off("click");
		$window.find(".btn-window-edit").off("click");
		$window.find(".btn-window-back").off("click");
		$window.find(".btn-window-cancel-edit").off("click");

		// Content mousedown listener (sets active window)
		$window.find(".window-content").off("mousedown");

		// Sidebar link listeners
		$window.find(".sidebar-link").off("click");
		$window.find(".sidebar-home-link").off("click");
		$window.find(".sidebar-category-header").off("click");

		// Sidebar edit mode handlers
		$window.find(".is-default-checkbox").off("change");
		$window.find(".btn-add-link").off("click");

		// Window title bar listeners (dragging)
		$window.find(".window-titlebar").off("mousedown");

		// Resize handle listeners
		$window.find(".resize-handle").off("mousedown");

		// Remove global window listeners attached for dragging and resizing
		const dragHandlers = $window.data("drag-handlers");
		if (dragHandlers) {
			$(window).off("mousemove", dragHandlers.move);
			$(window).off("mouseup", dragHandlers.up);
		}

		const resizeHandlers = $window.data("resize-handlers");
		if (resizeHandlers) {
			$(window).off("mousemove", resizeHandlers.move);
			$(window).off("mouseup", resizeHandlers.up);
		}

		// Clear all jQuery data stored on the window
		$window.removeData();
	}

	// === LOADING SPINNER INFRASTRUCTURE ===
	show_window_loading_spinner($window, message = "Loading...") {
		const $content = $window.find(".window-content");
		$content.find(".window-loading-spinner").remove();

		const $spinner = $(`
			<div class="window-loading-spinner" style="
				position: absolute;
				top: 0;
				left: 0;
				right: 0;
				bottom: 0;
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				background: var(--bg-color, #fff);
				z-index: 100;
			">
				<div class="spinner-border text-primary" role="status" style="width: 3rem; height: 3rem;">
					<span class="sr-only">${message}</span>
				</div>
				<p class="mt-3 text-muted">${message}</p>
			</div>
		`);

		$content.css("position", "relative").append($spinner);
		return $spinner;
	}

	hide_window_loading_spinner($window) {
		$window.find(".window-loading-spinner").fadeOut(200, function() {
			$(this).remove();
		});
	}

	// === CLEANUP ROUTER HOOKS ===
	// Call this method if workspace is destroyed to restore original router behavior
	cleanup_router_hooks() {
		if (frappe.router._deep_link_render_wrapped && frappe.router._original_render) {
			frappe.router.render = frappe.router._original_render;
			delete frappe.router._deep_link_render_wrapped;
			delete frappe.router._original_render;
		}

		// Restore Container.change_to if it was wrapped
		if (frappe.views.Container.prototype._original_change_to) {
			frappe.views.Container.prototype.change_to = frappe.views.Container.prototype._original_change_to;
			delete frappe.views.Container.prototype._original_change_to;
			delete frappe.views.Container.prototype._workspace_routing_setup;
		}

		// Restore jQuery methods if they were wrapped
		if (jQuery.fn._original_append) {
			jQuery.fn.append = jQuery.fn._original_append;
			jQuery.fn.prepend = jQuery.fn._original_prepend;
			delete jQuery.fn._original_append;
			delete jQuery.fn._original_prepend;
		}
	}

	// === DESTROY PAGE VIEWS (for fresh render) ===
	destroy_window_page_views($window) {
		const $content = $window.find(".window-content");

		$content.find(".window-page-view").each((index, wrapper) => {
			const $wrapper = $(wrapper);
			const $pages = $wrapper.find(".page-container");

			$pages.each((idx, page) => {
				const $page = $(page);
				// IMPORTANT: Do NOT call .off() on page elements!
				// This would destroy Frappe's original event handlers (forms, lists, etc.)
				// We only hide and move the page back to body for reuse
				$page.hide();
				$(document.body).append($page);
			});

			// Destroy the wrapper only (not the page content)
			$wrapper.remove();
		});
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

			// Store the editor instance for this window
			const $window = $(`#${editor_id}`).closest('.workspace-window');
			if ($window.length) {
				$window.data("workspace-editor", editor);
			}

			return editor;
		} catch (error) {
			console.error("Error initializing editor:", error);
			return null;
		}
	}

	async toggle_window_edit_mode($window, page) {
		const editor = $window.data("workspace-editor");

		if (!editor) {
			frappe.show_alert({
				message: __("Editor not ready yet. Please try again."),
				indicator: "orange"
			});
			return;
		}

		const isReadOnly = $window.data("is-read-only") !== false; // default to true

		if (isReadOnly) {
			// Enter edit mode for workspace content
			await editor.readOnly.toggle();
			$window.data("is-read-only", false);
			$window.addClass("window-edit-mode");

			// Change edit button to save button
			const $editBtn = $window.find(".btn-window-edit");
			$editBtn.attr("title", "Save Changes").text("💾");

			// Add cancel button
			$editBtn.after(`<button class="btn-window-cancel-edit" title="Cancel">✕</button>`);

			// Setup cancel button handler
			$window.find(".btn-window-cancel-edit").on("click", async () => {
				await this.cancel_window_edit_mode($window, page);
			});

			// Wait for editor to be ready, then make blocks sortable
			editor.isReady.then(() => {
				this.make_window_blocks_sortable($window, editor);
			});

		// ALSO enter edit mode for the sidebar (only for private workspaces)
		if (!page.public) {
			this.enter_sidebar_edit_mode($window, page);

			frappe.show_alert({
				message: __("Edit mode enabled (workspace + sidebar)"),
				indicator: "blue"
			});
		} else {
			// For public workspaces, only allow content editing, not sidebar customization
			frappe.show_alert({
				message: __("Edit mode enabled (content only)"),
				indicator: "blue"
			});
		}
	} else {
			// Save both workspace content AND sidebar customizations
			await this.save_both_workspace_and_sidebar($window, page, editor);
		}
	}

	make_window_blocks_sortable($window, editor) {
		// Find the editor container in this specific window
		const editorContainer = $window.find(".codex-editor__redactor").get(0);

		if (!editorContainer) {
			console.warn("Editor container not found for sortable");
			return;
		}

		// Create sortable instance
		const sortable = Sortable.create(editorContainer, {
			handle: ".drag-handle",
			draggable: ".ce-block",
			animation: 150,
			onEnd: function (evt) {
				editor.blocks.move(evt.newIndex, evt.oldIndex);
			},
			setData: function () {
				// Do Nothing
			},
		});

		// Store sortable instance so we can destroy it later
		$window.data("window-sortable", sortable);
	}

	destroy_window_sortable($window) {
		const sortable = $window.data("window-sortable");
		if (sortable) {
			sortable.destroy();
			$window.removeData("window-sortable");
		}
	}

	async save_both_workspace_and_sidebar($window, page, editor) {
		try {
			// Save workspace content
			await this.save_window_workspace($window, page, editor);

			// Save sidebar customizations (only for private workspaces)
			if (!page.public) {
				this.save_sidebar_customizations($window, page);

				// Exit sidebar edit mode after successful save
				// (workspace edit mode is already exited in save_window_workspace)
				const $sidebar = $window.find(".window-sidebar");
				$sidebar.removeClass("edit-mode");
			} else {
				window.location.reload(true)
			}

		} catch (error) {
			console.error("Error saving workspace and sidebar:", error);
			frappe.show_alert({
				message: __("Failed to save changes"),
				indicator: "red"
			});
		}
	}

	async cancel_window_edit_mode($window, page) {
		const editor = $window.data("workspace-editor");

		if (editor) {
			await editor.readOnly.toggle();
		}

		// Destroy sortable
		this.destroy_window_sortable($window);

		$window.data("is-read-only", true);
		$window.removeClass("window-edit-mode");

		// Restore edit button
		const $editBtn = $window.find(".btn-window-edit");
		$editBtn.attr("title", "Edit Workspace").text("✎");

		// Remove cancel button
		$window.find(".btn-window-cancel-edit").remove();

		// Exit sidebar edit mode too
		this.exit_sidebar_edit_mode($window, page);

		// Don't reload content - just show the workspace main content again
		// This prevents the preserved pages from being re-added to the DOM
		const $content = $window.find(".window-content");

		// Simply show the workspace main content again (no page view active)
		$content.find(".window-main").show();
		$content.find(".window-page-view").hide();

		frappe.show_alert({
			message: __("Edit cancelled"),
			indicator: "orange"
		});
	}

	async save_window_workspace($window, page, editor) {
		try {
			const outputData = await editor.save();

			// Extract new widgets from blocks
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

			// Filter out custom card types
			let blocks = outputData.blocks.filter(
				(item) =>
					item.type != "card" ||
					(item.data.card_name !== "Custom Documents" &&
						item.data.card_name !== "Custom Reports")
			);

			// Save to backend using the correct method
			await frappe.call({
				method: "frappe.desk.doctype.workspace.workspace.save_page",
				args: {
					title: page.title,
					public: page.public ? 1 : 0,
					new_widgets: new_widgets,
					blocks: JSON.stringify(blocks)
				}
			});

			// Destroy sortable
			this.destroy_window_sortable($window);

			// Exit edit mode
			await editor.readOnly.toggle();
			$window.data("is-read-only", true);
			$window.removeClass("window-edit-mode");

			// Restore edit button
			const $editBtn = $window.find(".btn-window-edit");
			$editBtn.attr("title", "Edit Workspace").text("✎");

			// Remove cancel button
			$window.find(".btn-window-cancel-edit").remove();

			frappe.show_alert({
				message: __("Workspace saved successfully"),
				indicator: "green"
			});
		} catch (error) {
			console.error("Error saving workspace:", error);
			frappe.show_alert({
				message: __("Failed to save workspace"),
				indicator: "red"
			});
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
		// FIX: Removed jQuery and frappe.router.on listeners to prevent "Triple Binding".
		// We rely solely on the Global Handler defined at the top of the file.
		
		// Fallback: If for some reason the global handler didn't run, wrap it here.
		if (!frappe.router._deep_link_render_wrapped && !frappe.router._original_render) {
			frappe.router._deep_link_render_wrapped = true;
			const original_render = frappe.router.render;
			const self = this;

			frappe.router.render = function(...args) {
				const renderContext = this;
				
				if (self.handle_deep_link_on_route_change) {
					self.handle_deep_link_on_route_change().then((handled) => {
						original_render.apply(renderContext, args);
					});
					return;
				}
				return original_render.apply(this, args);
			};
		}
	}

	async handle_deep_link_on_route_change() {
		// CRITICAL FIX: If already handling, return TRUE.
		// Returning 'false' would make the Global Handler execute the default view,
		// killing the window you are trying to open.
		if (this._handling_deep_link) {
			return true; 
		}

		const route = frappe.router.current_route;
		if (!route || route.length === 0) return false;

		// Filter out non-deep-link routes
		const first_part = route[0];
		if (first_part === "Workspaces") return false;

		const doctype_views = ["Form", "List", "Report", "Tree", "Kanban", "Calendar", "Gantt", "Dashboard", "Image", "Inbox", "Map", "query-report", "dashboard-view"];
		if (!doctype_views.includes(first_part)) return false;

		const doctype = route[1];
		if (!doctype) return false;

		// If a workspace window is already active and visible, return true.
		// This tells the system "We are handling this" so the Container hooks can
		// redirect the render into the existing window.
		if (this.active_workspace_window && (this.active_workspace_window.is(":visible") || this.active_workspace_window.hasClass("restoring"))) {
			return true;
		}

		this._handling_deep_link = true;

		try {
			// 1. Find the workspace
			let workspace = await this.find_workspace_for_doctype(doctype);

			if (!workspace) {
				workspace = this.get_fallback_workspace();
				// If strictly no workspace found, return false to let Frappe default view handle it
				if (!workspace) return false;
			}

			// 2. Open the window
			// This sets 'active_workspace_window', which triggers the logic in setup_window_routing
			await this.open_workspace_for_deep_link(workspace, route);
			
			return true; // Handled successfully
		} catch (e) {
			console.error("[Deep Link] Error:", e);
			return false; // Error occurred, fallback to default behavior
		} finally {
			// Always reset the lock
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

		// Check if we already have a workspace window open for this
		// If so, let the window routing handle the page display to avoid duplicate windows
		if (this.active_workspace_window && this.active_workspace_window.is(":visible")) {
			console.log("[Deep Link] Already have active workspace window, letting window routing handle page display");
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
		console.log(`[Deep Link] Opening workspace window: ${workspace.name}`);

		// 1. Check if window is already open
		// We use data attributes to find exact match
		const existing_window = $(`.workspace-window[data-page-name="${workspace.name}"]`);
		if (existing_window.length > 0) {
			console.log(`[Deep Link] Workspace window already open, reusing`);
			
			// --- FIX START: Restore minimized window ---
			if (existing_window.hasClass("minimized-to-dock")) {
				console.log(`[Deep Link] Window is minimized, restoring...`);
				this.restore_window_from_dock(existing_window);
			}

			// Bring to front to ensure it's on top of other windows
			this.window_z_index += 1;
			existing_window.css("z-index", this.window_z_index);
			// --- FIX END ---

			this.active_workspace_window = existing_window;
			return;
		}
		let obj = { name: workspace.name, public: workspace.public };
		let target_workspace = document.querySelector('.cx-ROOT-layout > .layout-side-section > .list-sidebar .sidebar-item-container[item-id="'+workspace.name+'"] .item-anchor');
		if (target_workspace) {
			obj.title = target_workspace.getAttribute('title')
		}
		// 2. Open new workspace window
		// FIX: Capture the return value directly. No need to query DOM or wait.
		const $window = this.open_workspace_window(obj,true);
		
		// 3. Set active immediately
		this.active_workspace_window = $window;
		
		console.log(`[Deep Link] Window opened and set active immediately`);
	}

	async handle_pending_deep_link(pending) {
		console.log(`[Deep Link] Handling pending deep link: ${pending.view} for ${pending.doctype}`);

		// 1. Define Views
		// These views map to real DocTypes 
		const doc_views = ["Form", "List", "Report", "Tree", "Kanban", "Calendar", "Gantt", "Dashboard", "Image", "Inbox", "Map"];
		
		let workspace = null;

		// 2. CRITICAL FIX: Only lookup DocType if the view expects a DocType.
		// For "query-report" or "dashboard-view", pending.doctype is actually a Report Name, 
		// so asking the server to look it up as a DocType will fail.
		if (doc_views.includes(pending.view)) {
			workspace = await this.find_workspace_for_doctype(pending.doctype);
		}

		// 3. Fallback Strategy
		if (!workspace) {
			console.log(`[Deep Link] No specific workspace found (or lookup skipped)`);
			workspace = this.get_fallback_workspace();

			if (!workspace) {
				console.log(`[Deep Link] ERROR: No fallback workspace available`);
				// Give up and route normally in main view
				setTimeout(() => {
					frappe.set_route(pending.route);
					// Clear flag
					setTimeout(() => { this.deep_link_processed_on_init = false; }, 500);
				}, 100);
				return;
			}
			console.log(`[Deep Link] Using fallback workspace: ${workspace.name}`);
		}

		// 4. Open Window (Deep Link Mode = true)
		await this.open_workspace_for_deep_link(workspace, pending.route);

		// 5. Trigger Navigation inside the window
		setTimeout(() => {
			frappe.set_route(pending.route);
			setTimeout(() => { this.deep_link_processed_on_init = false; }, 500);
		}, 200);
	}

	get_fallback_workspace() {
		// Try to find a good fallback workspace to use when doctype isn't found
		// Priority: Home > Tools > Build > First available

		const fallback_names = ["Tools", "Build", "Website"];

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

	// ============================================================================
	// macOS-Style Dock Methods for Minimized Windows
	// ============================================================================

	initialize_workspace_dock() {
		// Create dock element if it doesn't exist
		if (!this.dock_element) {
			this.dock_element = $(`<div class="workspace-dock" style="display: none;"></div>`);
			this.dock_element.appendTo("body");
		}
		this.minimized_windows = [];

		// Initialize snap guides for Windows 11 snap assist feature
		this.initialize_snap_guides();
	}

	initialize_snap_guides() {
		// Create snap guides container if it doesn't exist
		if (!this.snap_guides_container) {
			this.snap_guides_container = $(`
				<div class="snap-guides-container">
					<div class="snap-guide snap-guide-left">
						<div class="snap-guide-label">Snap Left</div>
					</div>
					<div class="snap-guide snap-guide-right">
						<div class="snap-guide-label">Snap Right</div>
					</div>
				</div>
			`);
			this.snap_guides_container.appendTo("body");
		}
	}

	minimize_window_to_dock($window) {
		const windowId = $window.attr("id");
		const windowTitle = $window.find(".window-title").text();

		// Save window state before minimizing
		$window.data("pre-minimize-position", {
			left: $window.css("left"),
			top: $window.css("top"),
			width: $window.css("width"),
			height: $window.css("height"),
			zIndex: $window.css("z-index")
		});

		// Get the dock item's position for the genie animation
		const dockRect = this.dock_element[0].getBoundingClientRect();
		const windowRect = $window[0].getBoundingClientRect();

		// Calculate offset for CSS variables
		const offsetX = dockRect.left + dockRect.width / 2 - windowRect.left - windowRect.width / 2;
		const offsetY = dockRect.top - windowRect.top - windowRect.height / 2;

		// Set CSS variables for animation
		$window.css({
			"--dock-offset-x": `${offsetX}px`,
			"--dock-offset-y": `${offsetY}px`
		});

		// Apply minimizing animation
		$window.addClass("minimizing");

		// After animation, hide window and add to dock
		setTimeout(() => {
			$window.removeClass("minimizing");
			$window.addClass("minimized-to-dock");
			$window.css("display", "none");

			// Add to minimized windows list
			this.minimized_windows.push({
				id: windowId,
				title: windowTitle,
				$window: $window
			});

			// Create and add dock item
			this.add_dock_item(windowId, windowTitle, $window);

			// Show dock
			this.update_dock_visibility();
		}, 400);
	}

	add_dock_item(windowId, windowTitle, $window) {
		// Get first letter or a default icon
		const firstLetter = windowTitle.charAt(0).toUpperCase();

		const $dockItem = $(`
			<div class="dock-item" data-window-id="${windowId}">
				<div class="dock-item-icon">${firstLetter}</div>
				<div class="dock-item-label">${windowTitle}</div>
			</div>
		`);

		// Click handler to restore window
		$dockItem.on("click", () => {
			this.restore_window_from_dock($window);
		});

		this.dock_element.append($dockItem);
	}

	restore_window_from_dock($window) {
		const windowId = $window.attr("id");

		// Get the dock item's position
		const $dockItem = this.dock_element.find(`[data-window-id="${windowId}"]`);
		if ($dockItem.length === 0) return;

		const dockRect = $dockItem[0].getBoundingClientRect();
		const preMinimizePos = $window.data("pre-minimize-position");

		if (!preMinimizePos) return;

		// Get current window rect for animation calculation
		const windowRect = $window[0].getBoundingClientRect();

		// Calculate reverse offset for animation
		const offsetX = dockRect.left + dockRect.width / 2 - (preMinimizePos.left + parseInt(preMinimizePos.width) / 2);
		const offsetY = dockRect.top - (preMinimizePos.top + parseInt(preMinimizePos.height) / 2);

		// Set CSS variables for reverse animation
		$window.css({
			"--dock-offset-x": `${offsetX}px`,
			"--dock-offset-y": `${offsetY}px`
		});

		// Show window and apply restoring animation
		$window.css("display", "");
		$window.addClass("restoring");

		// Bring window to front by incrementing z-index
		this.window_z_index += 1;
		$window.css("z-index", this.window_z_index);

		// Restore position after animation
		setTimeout(() => {
			$window.removeClass("restoring minimized-to-dock");
			$window.css({
				left: preMinimizePos.left,
				top: preMinimizePos.top,
				width: preMinimizePos.width,
				height: preMinimizePos.height,
				zIndex: this.window_z_index
			});

			// Remove from minimized windows list
			this.minimized_windows = this.minimized_windows.filter(w => w.id !== windowId);

			// Remove dock item
			$dockItem.remove();

			// Update dock visibility
			this.update_dock_visibility();
		}, 400);
	}

	update_dock_visibility() {
		if (this.minimized_windows.length === 0) {
			// Hide dock with animation
			this.dock_element.removeClass("visible").addClass("hidden");
			setTimeout(() => {
				this.dock_element.css("display", "none");
			}, 400);
		} else {
			// Show dock with animation
			this.dock_element.css("display", "");
			this.dock_element.removeClass("hidden");
			setTimeout(() => {
				this.dock_element.addClass("visible");
			}, 10);
		}
	}

	// ============================================================================
	// Windows 11 Snap Assist Methods
	// ============================================================================

	show_snap_guides() {
		if (this.snap_guides_container) {
			this.snap_guides_container.addClass("visible");
		}
	}

	hide_snap_guides() {
		if (this.snap_guides_container) {
			this.snap_guides_container.removeClass("visible");
			// Remove active class from all snap guides
			this.snap_guides_container.find(".snap-guide").removeClass("active");
		}
	}

	check_snap_region(clientX) {
		if (!this.snap_guides_container) return null;

		const $leftGuide = this.snap_guides_container.find(".snap-guide-left");
		const $rightGuide = this.snap_guides_container.find(".snap-guide-right");
		const viewportWidth = $(window).width();
		const SNAP_THRESHOLD = 60; // pixels from edge to trigger snap

		// Check if page is in RTL mode
		const isRTL = $("html").attr("dir") === "rtl" || getComputedStyle(document.documentElement).direction === "rtl";

		let snapRegion = null;

		if (isRTL) {
			// In RTL mode, left and right are inverted
			// Check if cursor is in left side (snap right zone in RTL)
			if (clientX < SNAP_THRESHOLD * 2) {
				$rightGuide.addClass("active");
				$leftGuide.removeClass("active");
				snapRegion = "right";
			}
			// Check if cursor is in right side (snap left zone in RTL)
			else if (clientX > viewportWidth - SNAP_THRESHOLD * 2) {
				$leftGuide.addClass("active");
				$rightGuide.removeClass("active");
				snapRegion = "left";
			}
			// Cursor is in middle, deactivate both
			else {
				$leftGuide.removeClass("active");
				$rightGuide.removeClass("active");
				snapRegion = null;
			}
		} else {
			// LTR mode (original logic)
			// Check if cursor is in left half (snap left zone)
			if (clientX < viewportWidth / 2 && clientX < SNAP_THRESHOLD * 2) {
				$leftGuide.addClass("active");
				$rightGuide.removeClass("active");
				snapRegion = "left";
			}
			// Check if cursor is in right half (snap right zone)
			else if (clientX > viewportWidth / 2 && clientX > viewportWidth - SNAP_THRESHOLD * 2) {
				$rightGuide.addClass("active");
				$leftGuide.removeClass("active");
				snapRegion = "right";
			}
			// Cursor is in middle, deactivate both
			else {
				$leftGuide.removeClass("active");
				$rightGuide.removeClass("active");
				snapRegion = null;
			}
		}

		return snapRegion;
	}

	snap_window($window, region) {
		if (!region) return;

		const viewportWidth = $(window).width();
		const viewportHeight = $(window).height();
		const snapWidth = viewportWidth / 2;
		const snapHeight = viewportHeight;

		// Check if page is in RTL mode
		const isRTL = $("html").attr("dir") === "rtl" || getComputedStyle(document.documentElement).direction === "rtl";

		// Get current position and size to preserve maximum/restore behavior
		const currentState = {
			left: $window.css("left"),
			right: $window.css("right"),
			top: $window.css("top"),
			width: $window.css("width"),
			height: $window.css("height")
		};

		// Save current state for unsnapping later
		if (!$window.data("snap-history")) {
			$window.data("snap-history", []);
		}
		$window.data("snap-history").push(currentState);

		// Apply snap layout based on region
		let snapConfig;
		if (isRTL) {
			// In RTL mode, swap left and right positioning
			snapConfig = region === "left" ? {
				left: "auto",
				right: "0px",
				top: "0px",
				width: snapWidth + "px",
				height: snapHeight + "px"
			} : {
				left: "auto",
				right: snapWidth + "px",
				top: "0px",
				width: snapWidth + "px",
				height: snapHeight + "px"
			};
		} else {
			// LTR mode (original logic)
			snapConfig = region === "left" ? {
				left: "0px",
				right: "auto",
				top: "0px",
				width: snapWidth + "px",
				height: snapHeight + "px"
			} : {
				left: snapWidth + "px",
				right: "auto",
				top: "0px",
				width: snapWidth + "px",
				height: snapHeight + "px"
			};
		}

		// Animate to snap position
		$window.css(snapConfig);
		$window.data("snap-region", region);
		$window.addClass("snapped");

		// Update z-index to bring to front
		this.window_z_index += 1;
		$window.css("z-index", this.window_z_index);
	}

	unsnap_window($window) {
		const snapHistory = $window.data("snap-history");
		if (!snapHistory || snapHistory.length === 0) return;

		// Restore to previous state
		const previousState = snapHistory.pop();
		$window.css(previousState);
		$window.removeData("snap-region");
		$window.removeClass("snapped");
	}

};
