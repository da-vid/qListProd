// Legacy application extracted from the production bundle. Data access uses the synthetic preview adapter.
if (window.addEventListener) {
    window.addEventListener("load", function() {
        FastClick.attach(document.body)
    }, false)
}
angular.module("quicklist", ["firebase", "qlist.preview", "linkify", "ui.sortable", "mgcrea.ngStrap", "ngAnimate"]).factory("listName", ["qlistData", function(b) {
    var a = b.ref("listAttrs/" + getListID() + "/listName");
    return b.bind(a)
}]).factory("listAttrs", ["qlistData", function(b) {
    var a = b.ref("listAttrs/" + getListID());
    return b.bind(a)
}]).controller("listController", ["$scope", "qlistData", "$modal", "listName", "listAttrs", function(m, a, g, k, l) {
    getListID();
    m.listName = k;
    m.listAttrs = l;
    var b = a.ref("lists/" + getListID());
    m.items = a.bind(b);
    m.loaded = false;
    m.title = "blah";
    m.content = "contentblah";
    m.checkedItemExists = false;
    var n = 10800000;
    var e = setTimeout(o, n);
    m.offline = false;
    if (!document.addEventListener) {
        document.attachEvent("keydown", f);
        document.attachEvent("mousedown", f);
        document.attachEvent("mousemove", f);
        document.attachEvent("touchstart", f)
    } else {
        document.addEventListener("keydown", f);
        document.addEventListener("mousedown", f);
        document.addEventListener("mousemove", f);
        document.addEventListener("touchstart", f)
    }
    var c = g({
        scope: m,
        template: "/shareModal.html",
        animation: "am-fade-and-slide-top",
        show: false
    });
    var h = g({
        scope: m,
        template: "/newListModal.html",
        animation: "am-fade-and-slide-top",
        show: false
    });
    var u = g({
        scope: m,
        template: "/deleteAllModal.html",
        animation: "am-fade-and-slide-top",
        show: false
    });
    var v = g({
        scope: m,
        template: "/tosModal.html",
        animation: "am-fade-and-slide-top",
        show: false
    });
    m.moreThanWhitespace = /\S/;
    m.defaultPageTitle = "qList.cc | quick lists";
    m.listNameFocused = false;
    var q = "my qList";
    var r = "name your list here";
    m.listNamePlaceholder = q;
    m.pageURL = document.location.href;
    m.pageDisplayURL = document.location.hostname + document.location.pathname;
    m.sortableOptions = {
        start: function(x, w) {
            f()
        },
        handle: ".gripper",
        disabled: false,
        containment: ".main"
    };
    m.addItem = function() {
        f();
        if (m.addItemForm.addItemBox.$valid) {
            b.child(m.nextItemID()).setWithPriority({
                ID: m.nextItemID(),
                name: m.itemName,
                checked: false
            }, m.nextPriority())
        }
        m.itemName = "";
        i();
        ga("send", "event", "listEvent", "addItem")
    };
    m.deleteItem = function(x) {
        f();
        var w = m.items.$getIndex();
        w.forEach(function(z, y) {
            if (m.items[z].ID === x) {
                m.items.$remove(z)
            }
        });
        i();
        ga("send", "event", "listEvent", "delItem");
        d()
    };
    m.deleteAllChecked = function() {
        f();
        var w = m.items.$getIndex();
        w.forEach(function(y, x) {
            if (m.items[y].checked) {
                m.items.$remove(y)
            }
        });
        i();
        ga("send", "event", "listEvent", "delAllItems");
        m.checkedItemExists = false
    };
    m.checkItem = function(w) {
        f();
        w.checked = !w.checked;
        m.items.$save();
        i();
        ga("send", "event", "listEvent", "checkItem");
        d()
    };
    m.items.$on("loaded", function() {
        setTimeout(t, 300)
    });

    function t() {
        m.loaded = true;
        d();
        m.$apply()
    }
    m.getListName = function() {
        if (!m.listName.$value) {
            return m.defaultPageTitle
        }
        return m.listName.$value
    };
    m.titleBoxFocus = function() {
        m.listNamePlaceholder = r;
        m.listNameFocused = true
    };
    m.titleBoxBlur = function() {
        m.listNamePlaceholder = q;
        m.listNameFocused = false;
        p()
    };

    function p() {
        f();
        m.listName.$set(m.listName.$value);
        i()
    }

    function f() {
        if (m.offline) {
            a.goOnline();
            console.log("Went Online.");
            m.offline = false
        }
        j()
    }

    function j() {
        clearTimeout(e);
        e = setTimeout(o, n)
    }

    function o() {
        a.goOffline();
        m.offline = true;
        console.log("Went offline.")
    }

    function i() {
        m.listAttrs.$update({
            lastMod: Math.floor(new Date().getTime() / 1000)
        })
    }
    m.nextItemID = function() {
        var w = 0;
        var x = m.items.$getIndex();
        x.forEach(function(z, y) {
            if (m.items[z].ID > w) {
                w = m.items[z].ID
            }
        });
        return w + 1
    };
    m.nextPriority = function() {
        var w = 0;
        var x = m.items.$getIndex();
        x.forEach(function(z, y) {
            if (m.items[z].$priority > w) {
                w = m.items[z].$priority
            }
        });
        return w + 1
    };

    function d() {
        var x = false;
        var w = m.items.$getIndex();
        w.forEach(function(z, y) {
            if (m.items[z].checked) {
                x = true
            }
        });
        m.checkedItemExists = x
    }

    function s() {
        d();
        m.$apply()
    }
    m.fbCount = function(y) {
        var x = 0;
        var w = y.$getIndex();
        w.forEach(function(A, z) {
            x++
        });
        return x
    };
    m.showShareModal = function() {
        c.$promise.then(function() {
            c.show()
        })
    };
    m.showDeleteAllModal = function() {
        u.$promise.then(function() {
            u.show()
        })
    };
    m.showNewListModal = function() {
        m.showModal(h)
    };
    m.showTosModal = function() {
        m.showModal(v)
    };
    m.showModal = function(w) {
        w.$promise.then(function() {
            w.show()
        })
    }
}]).directive("selectOnClick", function() {
    return {
        restrict: "A",
        link: function(c, b, a) {
            b.on("click", function() {
                this.select()
            })
        }
    }
}).directive("selectPageBox", function() {
    return {
        restrict: "A",
        link: function(c, b, a) {
            b.on("click", function() {
                document.getElementById("pageBox").select()
            })
        }
    }
});
