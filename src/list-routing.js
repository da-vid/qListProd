// Legacy URL/cookie behavior, preserved for the baseline.
function makeID() {
    var c = "";
    var a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    for (var b = 0; b < 6; b++) {
        c += a.charAt(Math.floor(Math.random() * a.length))
    }
    return c
}

function getID() {
    var a = window.location.pathname.substr(1);
    if (a.charAt(a.length - 1) === "/") {
        window.location.href = "../" + a.substr(0, a.length - 1)
    }
    return a
}

function getListID() {
    var b = getID();
    if (b === "new") {
        window.location.href = makeID()
    } else {
        if (b) {
            setCookie("lastList", b, 60);
            return b
        } else {
            var a = getCookie("lastList");
            if (a === "") {
                window.location.href = makeID()
            } else {
                window.location.href = a
            }
        }
    }
}

function setCookie(b, f, c) {
    var e = new Date();
    e.setTime(e.getTime() + (c * 24 * 60 * 60 * 1000));
    var a = "expires=" + e.toGMTString();
    document.cookie = b + "=" + f + "; " + a
}

function getCookie(d) {
    var b = d + "=";
    var a = document.cookie.split(";");
    for (var e = 0; e < a.length; e++) {
        var f = a[e].trim();
        if (f.indexOf(b) === 0) {
            return f.substring(b.length, f.length)
        }
    }
    return ""
};
