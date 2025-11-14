# 🚀 START HERE - Frappe Customization Guide

**Welcome!** This guide will help you navigate all the customizations made to this Frappe system.

---

## ❓ What Are You Looking For?

### 👤 "I need to understand what's been customized"
**Start here:** `MASTER_INDEX.md`
- Provides overview of all 15 customizations
- Lists all files and DocTypes affected
- Shows which feature is in which file
- ~15-20 minutes to read

### 🔧 "I need to modify workspace permissions"
**Start here:** `QUICK_REFERENCE.md` → `WORKSPACE_CUSTOMIZATION_REFERENCE.md`
- Quick lookup for permission changes
- Complete documentation of permission system
- Testing checklist included
- ~30-45 minutes

### 📊 "I need to understand how sidebar customization works"
**Start here:** `VISUAL_DIAGRAMS.md` → `WORKSPACE_CUSTOMIZATION_REFERENCE.md`
- See flow diagrams of sidebar selection
- Understand three-tier priority system
- Read complete documentation
- ~45-60 minutes

### 🪟 "I need to work with floating windows"
**Start here:** `/apps/frappe/frappe_docs/workspace_windows_system.md`
- Complete window system documentation
- Styling and layout information
- Performance optimization tips
- ~60 minutes

### 🔗 "I need to understand deep link handling"
**Start here:** `/apps/frappe/frappe_docs/routes_handling_inside_window.md`
- Deep link and route history documentation
- Complete implementation details
- Testing procedures
- ~45 minutes

### 📝 "I need to add a new feature"
**Start here:** `MASTER_INDEX.md` (Feature Integration Map) → Relevant documentation
- Understand where your feature fits
- See related features and code
- Follow the learning path
- ~2-4 hours depending on complexity

### 🐛 "Something is broken, I need to fix it"
**Start here:** `MASTER_INDEX.md` (Quick Code Lookup)
- Find which file to look at
- Find line numbers
- Find related documentation
- Then debug

---

## 📚 Documentation Files Overview

```
/home/corex/aurevia-bench/customizations/
│
├─ START_HERE.md ← YOU ARE HERE
│  └─ Navigation guide (this file)
│
├─ MASTER_INDEX.md ⭐ START HERE if unsure
│  └─ Complete overview of all 15 customizations
│  └─ Feature catalog with descriptions
│  └─ Architecture diagram
│  └─ Code lookup table
│  └─ Learning path for developers
│
├─ QUICK_REFERENCE.md
│  └─ Quick lookup table (1-2 page summary)
│  └─ Most important code sections highlighted
│  └─ Testing checklist
│  └─ Common mistakes to avoid
│
├─ WORKSPACE_CUSTOMIZATION_REFERENCE.md
│  └─ DETAILED guide for workspace permission system
│  └─ 7 functions explained in detail
│  └─ Backend reference documentation
│  └─ Complete workflows documented
│  └─ Testing checklist
│
└─ VISUAL_DIAGRAMS.md
   └─ Permission decision trees
   └─ Data flow diagrams
   └─ Workspace architecture diagrams
   └─ Sidebar rendering flows
   └─ Backend validation diagrams
```

---

## 🎯 Quick Navigation by Scenario

### Scenario 1: New Developer Starting
1. **Read:** START_HERE.md (this file) - 5 min
2. **Read:** MASTER_INDEX.md (overview) - 15 min
3. **Read:** QUICK_REFERENCE.md (summary) - 10 min
4. **Deep Dive:** Pick a feature of interest
5. **Explore:** Related code and documentation

**Total Time:** 30 minutes to understand the system

---

### Scenario 2: Need to Fix Workspace Permissions
1. **Quick Lookup:** QUICK_REFERENCE.md - Which function?
2. **Find Code:** Line number from quick reference
3. **Understand:** Read relevant section in WORKSPACE_CUSTOMIZATION_REFERENCE.md
4. **Test:** Use testing checklist from QUICK_REFERENCE.md
5. **Deploy:** Make changes and verify

**Total Time:** 45 minutes to understand and fix

---

### Scenario 3: Adding New Feature
1. **Understand System:** MASTER_INDEX.md (Feature Integration Map)
2. **Identify Impact:** Which other features are affected?
3. **Read Relevant Docs:** All related documentation
4. **Follow Learning Path:** MASTER_INDEX.md → Level 3
5. **Code Review:** Have another dev review using QUICK_REFERENCE.md checklist
6. **Test:** Complete testing checklist

**Total Time:** 3-8 hours depending on complexity

---

### Scenario 4: Performance Issue with Sidebars
1. **Check:** MASTER_INDEX.md (Performance Optimization Notes)
2. **Find Code:** MASTER_INDEX.md (Quick Code Lookup)
3. **Debug:** Review desktop.py (_check_link_permission) and caching
4. **Test:** Use load testing recommendations
5. **Optimize:** Apply solutions

**Total Time:** 1-2 hours

---

## 📖 Learning Paths

### Path A: UI/Frontend Focus (Floating Windows, Styling)
1. QUICK_REFERENCE.md
2. VISUAL_DIAGRAMS.md (Window system diagram)
3. `/apps/frappe/frappe_docs/workspace_windows_system.md`
4. workspace.js code review (Lines 1611-1735)
5. workspace_windows.scss review

**Time:** 2-3 hours

---

### Path B: Backend/Logic Focus (Permissions, Sidebar)
1. MASTER_INDEX.md
2. WORKSPACE_CUSTOMIZATION_REFERENCE.md
3. desktop.py review (Key methods sections)
4. workspace.py review
5. Code deep dive

**Time:** 3-4 hours

---

### Path C: Full System Understanding
1. START_HERE.md (this file)
2. MASTER_INDEX.md (complete)
3. QUICK_REFERENCE.md
4. VISUAL_DIAGRAMS.md
5. WORKSPACE_CUSTOMIZATION_REFERENCE.md
6. `/apps/frappe/frappe_docs/workspace_windows_system.md`
7. `/apps/frappe/frappe_docs/routes_handling_inside_window.md`
8. Code review: workspace.js, desktop.py, workspace.py

**Time:** 6-8 hours (Expert level)

---

## 🔗 Document Map

```
START_HERE.md (This File)
    ↓
MASTER_INDEX.md
├─ Quick Overview (15 min)
├─ Feature Catalog (30 min)
├─ Architecture Diagram (10 min)
└─ Learning Path (follow link)
    ↓
    ├─→ WORKSPACE_CUSTOMIZATION_REFERENCE.md (if fixing permissions)
    ├─→ workspace_windows_system.md (if working with UI)
    ├─→ routes_handling_inside_window.md (if working with routing)
    ├─→ QUICK_REFERENCE.md (for quick lookup)
    └─→ VISUAL_DIAGRAMS.md (for understanding flows)
```

---

## 🆘 Troubleshooting: Can't Find What You Need?

**Problem:** "I don't know where to start"
- **Solution:** Read MASTER_INDEX.md first, then use feature number

**Problem:** "I need to change something but don't know what file"
- **Solution:** Use MASTER_INDEX.md → "Quick Code Lookup" table
- **Or:** Use QUICK_REFERENCE.md → "Changes at a Glance" table

**Problem:** "I need to understand the flow"
- **Solution:** Use VISUAL_DIAGRAMS.md for flow charts and diagrams

**Problem:** "I want the quick version"
- **Solution:** Read QUICK_REFERENCE.md (2-3 page summary)

**Problem:** "I need complete details"
- **Solution:** Read WORKSPACE_CUSTOMIZATION_REFERENCE.md (complete guide)

**Problem:** "Something broke, I need to debug"
- **Solution:**
  1. Find relevant section in QUICK_REFERENCE.md
  2. Get line numbers and file paths
  3. Read testing checklist
  4. Debug using that information

---

## 📋 The 15 Customizations at a Glance

| # | Name | Type | Status |
|---|------|------|--------|
| 1 | Workspace User Sidebar | DocType + Backend | Active |
| 2 | Default Workspace Sidebar | DocType + Backend | Active |
| 3 | Floating Window System | Frontend | Active |
| 4 | Deep Link Handler | Frontend | Active |
| 5 | Route History | Frontend | Active |
| 6 | Permission Customization | Frontend + Backend | Active |
| 7 | Link Validation | Backend | Active |
| 8 | Accessibility Checks | Backend | Active |
| 9 | Three-Tier Sidebar | Backend Logic | Active |
| 10 | Save Customization | Backend | Active |
| 11 | Reset Sidebar | Backend | Active |
| 12 | Create Private Workspace | Backend | Active |
| 13 | Clone to Private | Backend | Active |
| 14 | Awesome Bar Integration | Frontend | Active |
| 15 | SCSS Styling System | Styling | Active |

**See:** MASTER_INDEX.md → Customization Catalog for details on each

---

## ✅ Before You Code

### Check This Checklist Before Modifying

- [ ] I've read MASTER_INDEX.md (at least the feature I'm modifying)
- [ ] I know which file to modify (from Quick Code Lookup)
- [ ] I understand the impact on related features
- [ ] I've reviewed the current implementation
- [ ] I have a testing plan (use QUICK_REFERENCE.md checklist)
- [ ] I understand backend vs frontend validation
- [ ] I've checked for security implications

### Before You Deploy

- [ ] Code reviewed by another developer
- [ ] All tests from QUICK_REFERENCE.md pass
- [ ] Tested on different browsers/devices
- [ ] Performance verified (if applicable)
- [ ] Security review completed
- [ ] Documentation updated (add to MASTER_INDEX.md if new feature)
- [ ] Rollback plan in place

---

## 🎓 Developer Tips

### Tip 1: Bookmark the Documents
- Keep `MASTER_INDEX.md` open in a tab
- Use it for quick lookups
- It has a comprehensive code reference table

### Tip 2: Use the Feature Numbers
- All features are numbered 1️⃣-1️⃣5️⃣
- When discussing changes, use "Feature #6" instead of long descriptions
- Makes communication clearer

### Tip 3: Check VISUAL_DIAGRAMS First
- If you're struggling to understand something
- Look at the relevant diagram
- Diagrams often make things click

### Tip 4: Follow the Learning Paths
- Don't try to understand everything at once
- Follow the learning path for your role
- It's ordered for efficient learning

### Tip 5: Keep Code Comments Updated
- When you modify code, update the comment
- When you add code, add explaining comment
- Future you will thank present you

---

## 🚨 Important Notes

### Security First
- **NEVER trust frontend-only validation**
- **ALWAYS validate on backend**
- Read: WORKSPACE_CUSTOMIZATION_REFERENCE.md → Important Notes section

### Performance Matters
- Check caching strategy before modifying
- Test with realistic data volumes
- See: MASTER_INDEX.md → Performance Optimization Notes

### Permission Checks Everywhere
- Every modification should check permissions
- Both frontend AND backend
- See: WORKSPACE_CUSTOMIZATION_REFERENCE.md → Permission Model

### Test Thoroughly
- Use the testing checklists provided
- Test all user roles (manager, regular user, owner)
- Test edge cases (deleted users, orphaned records, etc.)

---

## 📞 Getting Help

### If You're Stuck
1. **Check:** Is it in MASTER_INDEX.md? (search feature number)
2. **Check:** Is there a diagram in VISUAL_DIAGRAMS.md?
3. **Check:** Is it in QUICK_REFERENCE.md common mistakes?
4. **Search:** Look for the code section and read comments
5. **Review:** Previous implementation of similar feature
6. **Ask:** Team member (after checking above)

### Before You Ask for Help
- [ ] I've read MASTER_INDEX.md section for this feature
- [ ] I've checked VISUAL_DIAGRAMS.md for relevant flow
- [ ] I've reviewed the actual code and comments
- [ ] I've checked the code with similar functionality
- [ ] I've tried a reasonable fix attempt

This shows you've done your homework and makes it easier to help!

---

## 🎯 Your Next Steps

### Right Now
1. You're reading this file ✓
2. **Next:** Read MASTER_INDEX.md (~20 minutes)
3. **Then:** Read QUICK_REFERENCE.md (~10 minutes)

### This Week
1. Explore the features that interest you
2. Read the specific documentation for those features
3. Review the code sections mentioned
4. Run the test checklists

### This Month
1. Complete one of the learning paths (A, B, or C)
2. Make your first modification
3. Get code review from team
4. Deploy with confidence

---

## 🎉 You're All Set!

You now have:
- ✅ A complete guide to all 15 customizations
- ✅ Quick lookup tables and navigation
- ✅ Learning paths tailored to your role
- ✅ Testing checklists
- ✅ Common mistakes to avoid
- ✅ Security guidelines
- ✅ Performance tips

**Ready to get started?**

**👉 Next Step:** Open `MASTER_INDEX.md` and start reading!

---

**Questions? Tips?** Everything is documented. Use MASTER_INDEX.md as your guide!

**Good luck! 🚀**

---

**Document Created:** 2025-11-13
**Last Updated:** 2025-11-13
**Location:** `/home/corex/aurevia-bench/customizations/`

*This is your entry point. Everything else references this and MASTER_INDEX.md*
