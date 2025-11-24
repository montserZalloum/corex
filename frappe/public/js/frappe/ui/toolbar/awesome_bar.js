// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// MIT License. See license.txt
frappe.provide("frappe.search");
frappe.provide("frappe.tags");

frappe.search.AwesomeBar = class AwesomeBar {
	setup(element) {
		var me = this;

		$(".search-bar").removeClass("hidden");
		var $input = $(element);
		var input = $input.get(0);

		this.options = [];
		this.global_results = [];

		var awesomplete = new Awesomplete(input, {
			minChars: 0,
			maxItems: 99,
			autoFirst: true,
			list: [],
			filter: function (text, term) {
				return true;
			},
			data: function (item, input) {
				return {
					label: item.index || "",
					value: item.value,
				};
			},
			item: function (item, term) {
				const d = this.get_item(item.value);
				// Don't use actual route as href to prevent automatic navigation
				// The route is stored in data attribute and handled by awesomplete-select event
				let html = `<span>${__(d.label || d.value)}</span>`;

				if (d.description && d.value !== d.description) {
					html +=
						'<br><span class="text-muted ellipsis">' + __(d.description) + "</span>";
				}

				return $("<li></li>")
					.data("item.autocomplete", d)
					.html(`<a style="font-weight:normal" href="javascript:void(0)">${html}</a>`)
					.get(0);
			},
			sort: function (a, b) {
				return b.label - a.label;
			},
		});

		// Added to aid UI testing of global search
		input.awesomplete = awesomplete;

		this.awesomplete = awesomplete;

		$input.on(
			"input",
			frappe.utils.debounce(function (e) {
				var value = e.target.value;
				value = frappe.utils.xss_sanitise(value);
				var txt = value.trim().replace(/\s\s+/g, " ");
				var last_space = txt.lastIndexOf(" ");
				me.global_results = [];

				me.options = [];

				if (txt && txt.length > 1) {
					if (last_space !== -1) {
						me.set_specifics(txt.slice(0, last_space), txt.slice(last_space + 1));
					}
					me.add_defaults(txt);
					me.options = me.options.concat(me.build_options(txt));
					me.options = me.options.concat(me.global_results);
				} else {
					me.options = me.options.concat(
						me.deduplicate(frappe.search.utils.get_recent_pages(txt || ""))
					);
					me.options = me.options.concat(frappe.search.utils.get_frequent_links());
				}
				me.add_help();

				awesomplete.list = me.deduplicate(me.options);
			}, 100)
		);

		var open_recent = function () {
			if (!this.autocomplete_open) {
				$(this).trigger("input");
			}
		};
		$input.on("focus", open_recent);

		$input.on("awesomplete-open", function (e) {
			me.autocomplete_open = e.target;
		});

		$input.on("awesomplete-close", function (e) {
			me.autocomplete_open = false;
		});

		$input.on("awesomplete-select", async function (e) {
			// CRITICAL: Prevent ALL default behaviors FIRST to avoid race condition
			e.preventDefault();
			e.stopPropagation();

			var o = e.originalEvent;

			// Also prevent the underlying click event if it exists
			if (o && o.originalEvent) {
				o.originalEvent.preventDefault();
				o.originalEvent.stopPropagation();
			}

			var value = o.text.value;
			var item = awesomplete.get_item(value);

			console.log("[Awesomebar] Item selected:", item);
			console.log("[Awesomebar] Item route:", item.route);

			if (item.route_options) {
				frappe.route_options = item.route_options;
			}

			if (item.onclick) {
				item.onclick(item.match);
			} else {
				let event = o.originalEvent;
				if (event.ctrlKey || event.metaKey) {
					frappe.open_in_new_tab = true;
				}
				if (item.route[0].startsWith("https://")) {
					window.open(item.route[0], "_blank");
					return;
				}
				// WORKSPACE WINDOW INTEGRATION
				// If workspace system is available, try to open result in a workspace window
				const handled = await me.handle_awesomebar_selection(item.route);
				if (!handled) {
					// Fallback to default routing if not handled by workspace system
					frappe.set_route(item.route);
				}
			}
			$input.val("");
			$input.trigger("blur");
		});

		$input.on("awesomplete-selectcomplete", function (e) {
			$input.val("");
		});

		$input.on("keydown", (e) => {
			if (e.key == "Escape") {
				$input.trigger("blur");
			}
		});
		frappe.search.utils.setup_recent();
	}

	add_help() {
		this.options.push({
			value: __("Help on Search"),
			index: -10,
			default: "Help",
			onclick: function () {
				var txt =
					'<table class="table table-bordered">\
					<tr><td style="width: 50%">' +
					__("Create a new record") +
					"</td><td>" +
					__("new type of document") +
					"</td></tr>\
					<tr><td>" +
					__("List a document type") +
					"</td><td>" +
					__("document type..., e.g. customer") +
					"</td></tr>\
					<tr><td>" +
					__("Search in a document type") +
					"</td><td>" +
					__("text in document type") +
					"</td></tr>\
					<tr><td>" +
					__("Tags") +
					"</td><td>" +
					__("tag name..., e.g. #tag") +
					"</td></tr>\
					<tr><td>" +
					__("Open a module or tool") +
					"</td><td>" +
					__("module name...") +
					"</td></tr>\
					<tr><td>" +
					__("Calculate") +
					"</td><td>" +
					__("e.g. (55 + 434) / 4 or =Math.sin(Math.PI/2)...") +
					"</td></tr>\
				</table>";
				frappe.msgprint(txt, __("Search Help"));
			},
		});
	}

	set_specifics(txt, end_txt) {
		var me = this;
		var results = this.build_options(txt);
		results.forEach(function (r) {
			if (r.type && r.type.toLowerCase().indexOf(end_txt.toLowerCase()) === 0) {
				me.options.push(r);
			}
		});
	}

	add_defaults(txt) {
		this.make_global_search(txt);
		this.make_search_in_current(txt);
		this.make_calculator(txt);
		this.make_random(txt);
	}

	build_options(txt) {
		var options = frappe.search.utils
			.get_creatables(txt)
			.concat(
				frappe.search.utils.get_search_in_list(txt),
				frappe.search.utils.get_doctypes(txt),
				frappe.search.utils.get_reports(txt),
				frappe.search.utils.get_pages(txt),
				frappe.search.utils.get_workspaces(txt),
				frappe.search.utils.get_dashboards(txt),
				frappe.search.utils.get_recent_pages(txt || ""),
				frappe.search.utils.get_executables(txt),
				frappe.search.utils.get_marketplace_apps(txt)
			);
		if (txt.charAt(0) === "#") {
			options = frappe.tags.utils.get_tags(txt);
		}
		var out = this.deduplicate(options);
		return out.sort(function (a, b) {
			return b.index - a.index;
		});
	}

	deduplicate(options) {
		var out = [],
			routes = [];
		options.forEach(function (option) {
			if (option.route) {
				if (
					option.route[0] === "List" &&
					option.route[2] !== "Report" &&
					option.route[2] !== "Inbox"
				) {
					option.route.splice(2);
				}

				var str_route =
					typeof option.route === "string" ? option.route : option.route.join("/");
				if (routes.indexOf(str_route) === -1) {
					out.push(option);
					routes.push(str_route);
				} else {
					var old = routes.indexOf(str_route);
					if (out[old].index < option.index && !option.recent) {
						out[old] = option;
					}
				}
			} else {
				out.push(option);
				routes.push("");
			}
		});
		return out;
	}

	set_global_results(global_results, txt) {
		this.global_results = this.global_results.concat(global_results);
	}

	make_global_search(txt) {
		// let search_text = $(this.awesomplete.ul).find('.search-text');

		// if (txt.charAt(0) === "#" || !txt) {
		// 	search_text && search_text.remove();
		// 	return;
		// }

		// if (!search_text.length) {
		// 	search_text = $(this.awesomplete.ul).prepend(`
		// 		<div class="search-text">
		// 			<span class="search-text"></span>
		// 		<div>`
		// 	).find(".search-text");
		// }

		// search_text.html(`
		// 	<span class="flex justify-between">
		// 		<span class="ellipsis">Search for ${frappe.utils.xss_sanitise(txt).bold()}</span>
		// 		<kbd>↵</kbd>
		// 	</span>
		// `);

		// search_text.click(() => {
		// 	frappe.searchdialog.search.init_search(txt, "global_search");
		// });

		// REDESIGN TODO: Remove this as a selectable option
		if (txt.charAt(0) === "#") {
			return;
		}

		this.options.push({
			label: `
				<span class="flex justify-between text-medium">
					<span class="ellipsis">${__("Search for {0}", [frappe.utils.xss_sanitise(txt).bold()])}</span>
					<kbd>↵</kbd>
				</span>
			`,
			value: __("Search for {0}", [txt]),
			match: txt,
			index: 100,
			default: "Search",
			onclick: function () {
				frappe.searchdialog.search.init_search(txt, "global_search");
			},
		});
	}

	make_search_in_current(txt) {
		var route = frappe.get_route();
		if (route[0] === "List" && txt.indexOf(" in") === -1) {
			// search in title field
			const doctype = frappe.container.page?.list_view?.doctype;
			if (!doctype) return;
			var meta = frappe.get_meta(doctype);
			var search_field = meta.title_field || "name";
			var options = {};
			options[search_field] = ["like", "%" + txt + "%"];
			this.options.push({
				label: __("Find {0} in {1}", [
					frappe.utils.xss_sanitise(txt).bold(),
					__(route[1]).bold(),
				]),
				value: __("Find {0} in {1}", [txt, __(route[1])]),
				route_options: options,
				onclick: function () {
					cur_list.show();
				},
				index: 90,
				default: "Current",
				match: txt,
			});
		}
	}

	make_calculator(txt) {
		var first = txt.substr(0, 1);
		if (first == parseInt(first) || first === "(" || first === "=") {
			if (first === "=") {
				txt = txt.substr(1);
			}
			try {
				var val = eval(txt);
				var formatted_value = __("{0} = {1}", [txt, (val + "").bold()]);
				this.options.push({
					label: formatted_value,
					value: __("{0} = {1}", [txt, val]),
					match: val,
					index: 80,
					default: "Calculator",
					onclick: function () {
						frappe.msgprint(formatted_value, __("Result"));
					},
				});
			} catch (e) {
				// pass
			}
		}
	}

	make_random(txt) {
		if (txt.toLowerCase().includes("random")) {
			this.options.push({
				label: __("Generate Random Password"),
				value: frappe.utils.get_random(16),
				onclick: function () {
					frappe.msgprint(frappe.utils.get_random(16), __("Result"));
				},
			});
		}
	}

	async handle_awesomebar_selection(route) {
		// Handle awesomebar selection to open in workspace windows
		// This integrates with the OS-like desktop experience
		console.log("[Awesomebar] Handling selection (raw):", route, typeof route);
		// Check if workspace system is available
		if (!frappe.workspace) {
			console.log("[Awesomebar] Workspace system not available, using default routing");
			return false;
		}

		// Normalize route to array format
		let route_array;
		if (typeof route === "string") {
			// Split string route like "List/User" into ["List", "User"]
			route_array = route.split("/").filter(part => part.length > 0);
		} else if (Array.isArray(route)) {
			route_array = [...route]; // Clone to avoid modifying original
		} else {
			route_array = [route];
		}

		// Clean up malformed routes (e.g., ["List", "User", "List"] -> ["List", "User"])
		// Remove duplicate trailing "List" if it exists
		if (route_array.length >= 3 &&
		    route_array[0] === "List" &&
		    route_array[route_array.length - 1] === "List" &&
		    route_array[2] !== "Report" &&
		    route_array[2] !== "Inbox") {
			console.log("[Awesomebar] Detected malformed route with duplicate 'List', cleaning up");
			route_array = route_array.slice(0, 2); // Keep only ["List", "DocType"]
		}

		console.log("[Awesomebar] Normalized route:", route_array);

		if (!route_array || route_array.length === 0) {
			console.log("[Awesomebar] Empty route");
			return false;
		}

		// Check if this is a workspace route itself
		const first_part = route_array[0];
		if (first_part === "Workspaces" || route_array.includes("workspaces")) {
			console.log("[Awesomebar] This is a workspace route, handling it by opening a window.");
			
			// The workspace title is the second part of the route, e.g., "Users" from ["Workspaces", "Users"]
			const workspace_title = route_array[1];
			if (!workspace_title) return false; // Not a valid workspace route
		
			// Find the full workspace object from the master list
			const workspace_page = frappe.workspace.all_pages.find(p => p.title === workspace_title);
		
			if (workspace_page) {
				// We found it! Open it in a new window.
				frappe.workspace.open_workspace_window(workspace_page);
				
				// IMPORTANT: We handled the click, so return true to stop the default routing.
				return true; 
			}
		
			// If for some reason we can't find it, fallback to default.
			return false;
		}

		// Check if this is a doctype-related route
		const doctype_views = [
			"Form", "List", "Report", "Tree", "Kanban",
			"Calendar", "Gantt", "Dashboard", "Image",
			"Inbox", "Map"
		];

		let doctype = null;
		let is_doctype_route = false;

		// Extract doctype from route
		if (doctype_views.includes(first_part)) {
			// Routes like ["List", "User"] or ["Form", "User", "Administrator"]
			doctype = route_array[1];
			is_doctype_route = true;
		} else if (route_array.length === 1) {
			// Check if this is a doctype list route (e.g., ["User"])
			// We'll try to find a workspace for it anyway
			doctype = first_part;
			is_doctype_route = true;
		}

		if (!is_doctype_route || !doctype) {
			console.log("[Awesomebar] Not a doctype route, using default routing");
			return false;
		}

		console.log(`[Awesomebar] Doctype route detected: ${first_part} for ${doctype}`);
		try {
			// Find the appropriate workspace for this doctype
			let workspace = await frappe.workspace.find_workspace_for_doctype(doctype);

			if (!workspace) {
				console.log(`[Awesomebar] No specific workspace found for doctype: ${doctype}`);
				console.log(`[Awesomebar] Using fallback workspace strategy`);

				// Try fallback workspace
				workspace = frappe.workspace.get_fallback_workspace();

				if (!workspace) {
					console.log(`[Awesomebar] No fallback workspace available, using default routing`);
					return false;
				}

				console.log(`[Awesomebar] Using fallback workspace: ${workspace.name}`);
			} else {
				console.log(`[Awesomebar] Found workspace "${workspace.name}" for doctype: ${doctype}`);
			}

			// Open the workspace window and set it as active
			await frappe.workspace.open_workspace_for_deep_link(workspace, route_array);

			// Check if we're already on the target route
			const current_route = frappe.get_route();
			const routes_match = current_route.length === route_array.length &&
			                     current_route.every((part, i) => part === route_array[i]);

			if (routes_match) {
				// Already on this route - need to manually show page in window
				// because frappe.set_route() will be a no-op
				console.log(`[Awesomebar] Already on target route, manually showing page in window`);

				// Get the current page label
				const page_label = frappe.get_route_str();

				// Force display in window
				setTimeout(() => {
					if (frappe.workspace.active_workspace_window) {
						frappe.workspace.show_page_in_window(
							frappe.workspace.active_workspace_window,
							page_label
						);
					}
				}, 100);

				return true; // We handled it, skip default routing
			}

			// Different route - we need to navigate to the route
			// FIXED: Call frappe.set_route() here after window is opened,
			// instead of returning false and letting awesome_bar.js call it.
			// This ensures the window routing system is set up before the route changes.
			console.log(`[Awesomebar] Workspace window opened, navigating to route:`, route_array);

			// Mark the active window so navigate_to_default_link doesn't override this selection
			if (frappe.workspace.active_workspace_window) {
				frappe.workspace.active_workspace_window.data("awesomebar-selection-in-progress", true);
				console.log(`[Awesomebar] Marked window to skip default link navigation`);
			}

			// Use a small timeout to ensure DOM is fully updated
			setTimeout(() => {
				frappe.set_route(route_array);
			}, 50);

			return true; // We handled it, we're calling set_route ourselves
		} catch (error) {
			console.error("[Awesomebar] Error handling workspace selection:", error);
			return false; // Fallback to default routing
		}
	}
};
