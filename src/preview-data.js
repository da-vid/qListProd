/* Synthetic preview adapter. No Firebase connection, credentials, fetch, or WebSocket. */
(function (window) {
    'use strict';
    var productionHosts = ['qlist.cc', 'www.qlist.cc', 'qlist.netlify.app'];
    if (productionHosts.indexOf(window.location.hostname) !== -1) {
        throw new Error('This synthetic preview must not run on a production hostname.');
    }
    // Keep the legacy event calls harmless in this preview; no analytics SDK is loaded.
    window.ga = function () {};

    angular.module('qlist.preview', []).factory('qlistData', ['$rootScope', '$timeout', '$q', function ($rootScope, $timeout, $q) {
        var prefix = 'qlist:synthetic:v1:';
        var bindings = [];
        function clone(value) { return value === undefined ? null : JSON.parse(JSON.stringify(value)); }
        function failure(error) {
            var notice = document.getElementById('preview-notice');
            if (notice) {
                notice.setAttribute('data-error', 'true');
                notice.textContent = 'Preview storage is unavailable. Your change was not saved. Allow browser storage and reload.';
            }
            throw error;
        }
        function initial(id) {
            return id === 'Demo23' ? {
                attrs: { listName: 'Sample shopping list' },
                items: {
                    '1': { ID: 1, name: 'Apples', checked: false, '.priority': 1 },
                    '2': { ID: 2, name: 'Bread', checked: true, '.priority': 2 },
                    '3': { ID: 3, name: 'Milk', checked: false, '.priority': 3 }
                }
            } : { attrs: {}, items: {} };
        }
        function read(id) {
            try {
                var stored = window.localStorage.getItem(prefix + id);
                if (stored === null) return initial(id);
                var record = JSON.parse(stored);
                if (!record || typeof record.attrs !== 'object' || typeof record.items !== 'object') throw new Error('Invalid preview storage');
                return record;
            } catch (error) { return failure(error); }
        }
        function notify() {
            bindings.forEach(function (binding) { binding.refresh(); });
            $rootScope.$evalAsync(function () {});
        }
        function persist(id, record) {
            try { window.localStorage.setItem(prefix + id, JSON.stringify(record)); }
            catch (error) { return failure(error); }
            notify();
        }
        function parse(path) {
            var parts = path.split('/');
            if (!/^(lists|listAttrs)$/.test(parts[0]) || parts.length < 2 || parts.length > 3 || parts.slice(1).some(function (part) {
                return !/^[A-Za-z0-9_-]+$/.test(part) || ['__proto__', 'constructor', 'prototype'].indexOf(part) !== -1;
            })) throw new Error('Only a list-scoped synthetic reference is allowed');
            return parts;
        }
        function ref(path) {
            var parts = parse(path);
            return {
                path: path,
                child: function (key) { return ref(path + '/' + key); },
                setWithPriority: function (value, priority) {
                    var item = clone(value);
                    item['.priority'] = priority;
                    write(parts, item);
                }
            };
        }
        function valueAt(parts) {
            var record = read(parts[1]);
            var branch = record[parts[0] === 'lists' ? 'items' : 'attrs'];
            return parts.length === 3 ? branch[parts[2]] : branch;
        }
        function write(parts, value) {
            var record = read(parts[1]);
            var key = parts[0] === 'lists' ? 'items' : 'attrs';
            if (parts.length === 2) record[key] = clone(value) || {};
            else if (value === null || value === undefined) delete record[key][parts[2]];
            else record[key][parts[2]] = clone(value);
            persist(parts[1], record);
        }
        function decode(value) {
            if (!value || typeof value !== 'object') return value;
            var result = {};
            Object.keys(value).forEach(function (key) {
                result[key === '.priority' ? '$priority' : key] = decode(value[key]);
            });
            return result;
        }
        function encode(value) {
            if (!value || typeof value !== 'object') return value;
            var result = {};
            Object.keys(value).forEach(function (key) {
                if (key === '$priority') result['.priority'] = value[key];
                else if (key.charAt(0) !== '$') result[key] = encode(value[key]);
            });
            return result;
        }
        function bind(reference) {
            var parts = parse(reference.path);
            var model = {};
            function refresh() {
                Object.keys(model).forEach(function (key) { delete model[key]; });
                var value = valueAt(parts);
                if (parts.length === 3) model.$value = value === undefined ? null : clone(value);
                else Object.assign(model, decode(value || {}));
            }
            Object.defineProperties(model, {
                $getIndex: { value: function () {
                    return Object.keys(model).filter(function (key) { return key.charAt(0) !== '$'; }).sort(function (a, b) {
                        return ((model[a] || {}).$priority || 0) - ((model[b] || {}).$priority || 0) || a.localeCompare(b, 'en', { numeric: true });
                    });
                } },
                $on: { value: function (event, callback) {
                    if (event !== 'loaded') throw new Error('Unsupported synthetic event: ' + event);
                    $timeout(callback);
                    return model;
                } },
                $save: { value: function () { write(parts, encode(model)); return $q.when(); } },
                $set: { value: function (value) { write(parts, value); return $q.when(); } },
                $update: { value: function (value) {
                    write(parts, Object.assign({}, valueAt(parts), value));
                    return $q.when();
                } },
                $remove: { value: function (key) {
                    write(key === undefined ? parts : parse(reference.path + '/' + key), null);
                    return $q.when();
                } }
            });
            bindings.push({ refresh: refresh });
            refresh();
            return model;
        }
        window.addEventListener('storage', function (event) {
            if (event.key === null || event.key.indexOf(prefix) === 0) notify();
        });
        return { ref: ref, bind: bind, goOnline: function () {}, goOffline: function () {} };
    }]);
})(window);
