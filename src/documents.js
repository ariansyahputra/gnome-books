/*
 * Copyright (c) 2011, 2012, 2013, 2014 Red Hat, Inc.
 *
 * Gnome Documents is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Documents is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

const EvDocument = imports.gi.EvinceDocument;
const EvView = imports.gi.EvinceView;
const EPUBView = imports.epubview;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const Gd = imports.gi.Gd;
const GdPrivate = imports.gi.GdPrivate;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const GnomeDesktop = imports.gi.GnomeDesktop;
const Gtk = imports.gi.Gtk;
const _ = imports.gettext.gettext;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Application = imports.application;
const ChangeMonitor = imports.changeMonitor;
const Manager = imports.manager;
const Notifications = imports.notifications;
const Query = imports.query;
const Search = imports.search;
const TrackerUtils = imports.trackerUtils;
const Utils = imports.utils;
const WindowMode = imports.windowMode;

const DeleteItemJob = new Lang.Class({
    Name: 'DeleteItemJob',
// deletes the given resource

    _init: function(urn) {
        this._urn = urn;
    },

    run: function(callback) {
        this._callback = callback;

        let query = Application.queryBuilder.buildDeleteResourceQuery(this._urn);
        Application.connectionQueue.update(query.sparql, null, Lang.bind(this,
            function(object, res) {
                try {
                    object.update_finish(res);
                } catch (e) {
                    logError(e, 'Failed to delete resource ' + this._urn);
                }

                if (this._callback)
                    this._callback();
            }));
    }
});


const CollectionIconWatcher = new Lang.Class({
    Name: 'CollectionIconWatcher',

    _init: function(collection) {
        this._collection = collection;
        this._pixbuf = null;

        this._start();
    },

    _clear: function() {
        this._docConnections = {};
        this._urns = [];
        this._docs = [];
    },

    _start: function() {
        this._clear();

        let query = Application.queryBuilder.buildCollectionIconQuery(this._collection.id);
        Application.connectionQueue.add(query.sparql, null, Lang.bind(this,
            function(object, res) {
                let cursor = null;
                try {
                    cursor = object.query_finish(res);
                } catch (e) {
                    logError(e, 'Unable to query collection items');
                    return;
                }

                cursor.next_async(null, Lang.bind(this, this._onCursorNext));
            }));
    },

    _onCursorNext: function(cursor, res) {
        let valid = false;

        try {
            valid = cursor.next_finish(res);
        } catch (e) {
            logError(e, 'Unable to query collection items');
            cursor.close();
            return;
        }

        if (!valid) {
            cursor.close();
            this._onCollectionIconFinished();

            return;
        }

        let urn = cursor.get_string(0)[0];
        this._urns.push(urn);

        cursor.next_async(null, Lang.bind(this, this._onCursorNext));
    },

    _onCollectionIconFinished: function() {
        if (!this._urns.length)
            return;

        // now this._urns has all the URNs of items contained in the collection
        let toQuery = [];

        this._urns.forEach(Lang.bind(this,
            function(urn) {
                let doc = Application.documentManager.getItemById(urn);
                if (doc)
                    this._docs.push(doc);
                else
                    toQuery.push(urn);
            }));

        this._toQueryRemaining = toQuery.length;
        if (!this._toQueryRemaining) {
            this._allDocsReady();
            return;
        }

        toQuery.forEach(Lang.bind(this,
            function(urn) {
                let job = new TrackerUtils.SingleItemJob(urn, Application.queryBuilder);
                job.run(Query.QueryFlags.UNFILTERED, Lang.bind(this,
                    function(cursor) {
                        if (cursor) {
                            let doc = Application.documentManager.createDocumentFromCursor(cursor);
                            this._docs.push(doc);
                        }

                        this._toQueryCollector();
                    }));
            }));
    },

    _toQueryCollector: function() {
        this._toQueryRemaining--;

        if (!this._toQueryRemaining)
            this._allDocsReady();
    },

    _allDocsReady: function() {
        this._docs.forEach(Lang.bind(this,
            function(doc) {
                let updateId = doc.connect('info-updated',
                                           Lang.bind(this, this._createCollectionIcon));
                this._docConnections[updateId] = doc;
            }));

        this._createCollectionIcon();
    },

    _createCollectionIcon: function() {
        // now this._docs has an array of Document objects from which we will create the
        // collection icon
        let pixbufs = [];

        this._docs.forEach(
            function(doc) {
                if (doc.origPixbuf) {
                    if (doc._thumbPath && !doc._failedThumbnailing)
                        doc.origPixbuf.set_option('-documents-has-thumb', 'true');
                    else
                        doc.origPixbuf.remove_option('-documents-has-thumb');
                    pixbufs.push(doc.origPixbuf);
                }
            });

        this._pixbuf = GdPrivate.create_collection_icon(
            Utils.getIconSize() * Application.application.getScaleFactor(),
            pixbufs);
        this._emitRefresh();
    },

    _emitRefresh: function() {
        this.emit('icon-updated', this._pixbuf);
    },

    destroy: function() {
        for (let id in this._docConnections) {
            let doc = this._docConnections[id];
            doc.disconnect(id);
        }
    },

    refresh: function() {
        this.destroy();
        this._start();
    }
});
Signals.addSignalMethods(CollectionIconWatcher.prototype);

const DocCommon = new Lang.Class({
    Name: 'DocCommon',

    _init: function(cursor) {
        this.id = null;
        this.uri = null;
        this.uriToLoad = null;
        this.filename = null;
        this.name = null;
        this.author = null;
        this.mtime = null;
        this.resourceUrn = null;
        this.surface = null;
        this.origPixbuf = null;
        this.defaultApp = null;
        this.defaultAppName = null;

        this.mimeType = null;
        this.rdfType = null;
        this.dateCreated = null;
        this.typeDescription = null;
        this.sourceName = null;

        this.rowRefs = {};
        this.shared = false;

        this.collection = false;
        this._collectionIconWatcher = null;

        this._thumbPath = null;

        this.populateFromCursor(cursor);

        this._refreshIconId =
            Application.settings.connect('changed::view-as',
                                         Lang.bind(this, this.refreshIcon));
    },

    refresh: function() {
        let job = new TrackerUtils.SingleItemJob(this.id, Application.queryBuilder);
        job.run(Query.QueryFlags.NONE, Lang.bind(this,
            function(cursor) {
                if (!cursor)
                    return;

                this.populateFromCursor(cursor);
            }));
    },

    _sanitizeTitle: function() {
        this.name = this.name.replace(/Microsoft Word - /g, '');
    },

    populateFromCursor: function(cursor) {
        this.uri = cursor.get_string(Query.QueryColumns.URI)[0];
        this.id = cursor.get_string(Query.QueryColumns.URN)[0];
        this.identifier = cursor.get_string(Query.QueryColumns.IDENTIFIER)[0];
        this.author = cursor.get_string(Query.QueryColumns.AUTHOR)[0];
        this.resourceUrn = cursor.get_string(Query.QueryColumns.RESOURCE_URN)[0];

        let mtime = cursor.get_string(Query.QueryColumns.MTIME)[0];
        if (mtime) {
            let timeVal = GLib.time_val_from_iso8601(mtime)[1];
            this.mtime = timeVal.tv_sec;
        } else {
            this.mtime = Math.floor(GLib.get_real_time() / 1000000);
        }

        this.mimeType = cursor.get_string(Query.QueryColumns.MIMETYPE)[0];
        this.rdfType = cursor.get_string(Query.QueryColumns.RDFTYPE)[0];
        this._updateInfoFromType();

        let dateCreated = cursor.get_string(Query.QueryColumns.DATE_CREATED)[0];
        if (dateCreated) {
            let timeVal = GLib.time_val_from_iso8601(dateCreated)[1];
            this.dateCreated = timeVal.tv_sec;
        } else {
            this.dateCreated = -1;
        }

        // sanitize
        if (!this.uri)
            this.uri = '';

        let title = cursor.get_string(Query.QueryColumns.TITLE)[0];
        this.filename = cursor.get_string(Query.QueryColumns.FILENAME)[0];

        if (title && title != '')
            this.name = title;
        else if (this.filename)
            this.name = GdPrivate.filename_strip_extension(this.filename);
        else
            this.name = '';

        this._sanitizeTitle();

        this.refreshIcon();
    },

    updateIconFromType: function() {
        let icon = null;

        if (this.mimeType)
            icon = Gio.content_type_get_icon(this.mimeType);

        if (!icon)
            icon = Utils.iconFromRdfType(this.rdfType);

        let iconInfo =
            Gtk.IconTheme.get_default().lookup_by_gicon_for_scale(icon, Utils.getIconSize(),
                                                                  Application.application.getScaleFactor(),
                                                                  Gtk.IconLookupFlags.FORCE_SIZE);

        let pixbuf = null;
        if (iconInfo != null) {
            try {
                pixbuf = iconInfo.load_icon();
                this._setOrigPixbuf(pixbuf);
            } catch (e) {
                logError(e, 'Unable to load pixbuf');
            }
        }
    },

    _refreshCollectionIcon: function() {
        if (!this._collectionIconWatcher) {
            this._collectionIconWatcher = new CollectionIconWatcher(this);

            this._collectionIconWatcher.connect('icon-updated', Lang.bind(this,
                function(watcher, pixbuf) {
                    this._setOrigPixbuf(pixbuf);
                }));
        } else {
            this._collectionIconWatcher.refresh();
        }
    },

    download: function(useCache, cancellable, callback) {
        let localFile = Gio.File.new_for_uri(this.uriToLoad);
        let localPath = localFile.get_path();
        let localDir = GLib.path_get_dirname(localPath);
        GLib.mkdir_with_parents(localDir, 448);

        if (!useCache) {
            Utils.debug('Downloading ' + this.__name__ + ' ' + this.id + ' to ' + this.uriToLoad +
                        ': bypass cache ');
            this.downloadImpl(localFile, cancellable, callback);
            return;
        }

        localFile.query_info_async(Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
                                   Gio.FileQueryInfoFlags.NONE,
                                   GLib.PRIORITY_DEFAULT,
                                   cancellable,
                                   Lang.bind(this,
            function(object, res) {
                let info;

                try {
                    info = object.query_info_finish(res);
                } catch (e) {
                    Utils.debug('Downloading ' + this.__name__ + ' ' + this.id + ' to ' + this.uriToLoad +
                                ': cache miss');
                    this.downloadImpl(localFile, cancellable, callback);
                    return;
                }

                let cacheMtime = info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED);
                if (this.mtime <= cacheMtime) {
                    callback(true, null);
                    return;
                }

                Utils.debug('Downloading ' + this.__name__ + ' ' + this.id + ' to ' + this.uriToLoad +
                            ': cache stale (' + this.mtime + ' > ' + cacheMtime + ')');
                this.downloadImpl(localFile, cancellable, callback);
            }));
    },

    downloadImpl: function(localFile, cancellable, callback) {
        throw(new Error('DocCommon implementations must override downloadImpl'));
    },

    load: function(passwd, cancellable, callback) {
        Utils.debug('Loading ' + this.__name__ + ' ' + this.id);

        if (this.collection) {
            Mainloop.idle_add(Lang.bind(this,
                function() {
                    let error = new GLib.Error(Gio.IOErrorEnum,
                                               Gio.IOErrorEnum.NOT_SUPPORTED,
                                               "Collections can't be loaded");
                    callback(this, null, error);
                    return GLib.SOURCE_REMOVE;
                }));

            return;
        }

        this.download(true, cancellable, Lang.bind(this,
            function(fromCache, error) {
                if (error) {
                    callback(this, null, error);
                    return;
                }

                this.loadLocal(passwd, cancellable, Lang.bind(this,
                    function(doc, docModel, error) {
                        if (error) {
                            if (fromCache &&
                                !error.matches(EvDocument.DocumentError, EvDocument.DocumentError.ENCRYPTED)) {
                                this.download(false, cancellable, Lang.bind(this,
                                    function(fromCache, error) {
                                        if (error) {
                                            callback(this, null, error);
                                            return;
                                        }

                                        this.loadLocal(passwd, cancellable, callback);
                                    }));
                            } else {
                                callback(this, null, error);
                            }

                            return;
                        }

                        callback(this, docModel, null);
                    }));
            }));
    },

    canEdit: function() {
        throw(new Error('DocCommon implementations must override canEdit'));
    },

    canTrash: function() {
        throw(new Error('DocCommon implementations must override canTrash'));
    },

    canPrint: function(docModel) {
        if (this.collection)
            return false;

        if (!docModel)
            return false;

        return EvView.PrintOperation.exists_for_document(docModel.get_document());
    },

    trash: function() {
        if (!this.canTrash())
            return;

        this.trashImpl();

        let job = new DeleteItemJob(this.id);
        job.run(null);
    },

    trashImpl: function() {
        throw(new Error('DocCommon implementations must override trashImpl'));
    },

    createThumbnail: function(callback) {
        throw(new Error('DocCommon implementations must override createThumbnail'));
    },

    refreshIcon: function() {
        if (this._thumbPath) {
            this._refreshThumbPath();
            return;
        }

        this.updateIconFromType();

        if (this.collection) {
            this._refreshCollectionIcon();
            return;
        }

        if (this._failedThumbnailing)
            return;

        this._file = Gio.file_new_for_uri(this.uri);
        this._file.query_info_async(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH,
                                    Gio.FileQueryInfoFlags.NONE,
                                    GLib.PRIORITY_DEFAULT,
                                    null,
                                    Lang.bind(this, this._onFileQueryInfo));
    },

    _onFileQueryInfo: function(object, res) {
        let info = null;
        let haveNewIcon = false;

        try {
            info = object.query_info_finish(res);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                logError(e, 'Unable to query info for file at ' + this.uri);
            else
                Utils.debug('Unable to query info for file at ' + this.uri);
            this._failedThumbnailing = true;
            return;
        }

        this._thumbPath = info.get_attribute_byte_string(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH);
        if (this._thumbPath) {
            this._refreshThumbPath();
        } else {
            this.createThumbnail(Lang.bind(this, this._onCreateThumbnail));
        }
    },

    _onCreateThumbnail: function(thumbnailed) {
        if (!thumbnailed) {
            this._failedThumbnailing = true;
            return;
        }

        // get the new thumbnail path
        this._file.query_info_async(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH,
                                    Gio.FileQueryInfoFlags.NONE,
                                    GLib.PRIORITY_DEFAULT,
                                    null,
                                    Lang.bind(this, this._onThumbnailPathInfo));
    },

    _onThumbnailPathInfo: function(object, res) {
        let info = null;

        try {
            info = object.query_info_finish(res);
        } catch (e) {
            logError(e, 'Unable to query info for file at ' + this.uri);
            this._failedThumbnailing = true;
            return;
        }

        this._thumbPath = info.get_attribute_byte_string(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH);
        if (this._thumbPath)
            this._refreshThumbPath();
        else
            this._failedThumbnailing = true;
    },

    _refreshThumbPath: function() {
        let thumbFile = Gio.file_new_for_path(this._thumbPath);

        thumbFile.read_async(GLib.PRIORITY_DEFAULT, null, Lang.bind(this,
            function(object, res) {
                let stream;

                try {
                    stream = object.read_finish(res);
                } catch (e) {
                    logError(e, 'Unable to read file at ' + thumbFile.get_uri());
                    this._failedThumbnailing = true;
                    this._thumbPath = null;
                    thumbFile.delete_async(GLib.PRIORITY_DEFAULT, null, null);
                    return;
                }

                let scale = Application.application.getScaleFactor();
                GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream,
                    Utils.getIconSize() * scale, Utils.getIconSize() * scale,
                    true, null, Lang.bind(this,
                        function(object, res) {
                            // close the underlying stream immediately
                            stream.close_async(0, null, null);

                            let pixbuf;

                            try {
                                pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(res);
                            } catch (e) {
                                if (!e.matches(GdkPixbuf.PixbufError, GdkPixbuf.PixbufError.UNKNOWN_TYPE))
                                    logError(e, 'Unable to create pixbuf from ' + thumbFile.get_uri());

                                this._failedThumbnailing = true;
                                this._thumbPath = null;
                                thumbFile.delete_async(GLib.PRIORITY_DEFAULT, null, null);
                                return;
                            }

                            this._setOrigPixbuf(pixbuf);
                        }));
            }));
    },

    _updateInfoFromType: function() {
        if (this.rdfType.indexOf('nfo#DataContainer') != -1)
            this.collection = true;

        this.updateTypeDescription();
    },

    _createSymbolicEmblem: function(name) {
        let pix = Gd.create_symbolic_icon(name, Utils.getIconSize() *
                                          Application.application.getScaleFactor());

        if (!pix)
            pix = new Gio.ThemedIcon({ name: name });

        return pix;
    },

    _setOrigPixbuf: function(pixbuf) {
        if (pixbuf) {
            this.origPixbuf = pixbuf;
        }

        this._checkEffectsAndUpdateInfo();
    },

    _checkEffectsAndUpdateInfo: function() {
        if (!this.origPixbuf)
            return;

        let emblemIcons = [];
        let emblemedPixbuf = this.origPixbuf;

        if (this.shared)
            emblemIcons.push(this._createSymbolicEmblem('emblem-shared'));

        if (emblemIcons.length > 0) {
            let emblemedIcon = new Gio.EmblemedIcon({ gicon: this.origPixbuf });

            emblemIcons.forEach(
                function(emblemIcon) {
                    let emblem = new Gio.Emblem({ icon: emblemIcon });
                    emblemedIcon.add_emblem(emblem);
                });

            let theme = Gtk.IconTheme.get_default();

            try {
                let iconInfo = theme.lookup_by_gicon(emblemedIcon,
                                                     Math.max(this.origPixbuf.get_width(),
                                                              this.origPixbuf.get_height()),
                                                     Gtk.IconLookupFlags.FORCE_SIZE);

                emblemedPixbuf = iconInfo.load_icon();
            } catch (e) {
                logError(e, 'Unable to render the emblem');
            }
        }

        let thumbnailedPixbuf = null;

        if (this._thumbPath) {
            let [ slice, border ] = Utils.getThumbnailFrameBorder();
            thumbnailedPixbuf = Gd.embed_image_in_frame(emblemedPixbuf,
                'resource:///org/gnome/Documents/ui/thumbnail-frame.png',
                slice, border);
        } else {
            thumbnailedPixbuf = emblemedPixbuf;
        }

        this.surface = Gdk.cairo_surface_create_from_pixbuf(thumbnailedPixbuf,
            Application.application.getScaleFactor(),
            Application.application.getGdkWindow());

        this.emit('info-updated');
    },

    destroy: function() {
        if (this._collectionIconWatcher) {
            this._collectionIconWatcher.destroy();
            this._collectionIconWatcher = null;
        }

        Application.settings.disconnect(this._refreshIconId);
    },

    loadLocal: function(passwd, cancellable, callback) {
        Utils.debug('Loading ' + this.__name__ + ' ' + this.id + ' from ' + this.uriToLoad);

        if (this.mimeType == 'application/x-mobipocket-ebook' ||
            this.mimeType == 'application/x-fictionbook+xml' ||
            this.mimeType == 'application/x-zip-compressed-fb2') {
            let exception = new GLib.Error(Gio.IOErrorEnum,
                                           Gio.IOErrorEnum.NOT_SUPPORTED,
                                           "Internal error: Ebooks preview isn't support yet");
            callback(this, null, exception);
            return;
        }

        if (EPUBView.isEpub(this.mimeType)) {
            callback(this, null, null);
            return;
        }

        GdPrivate.pdf_loader_load_uri_async(this.uriToLoad, passwd, cancellable, Lang.bind(this,
            function(source, res) {
                try {
                    let docModel = GdPrivate.pdf_loader_load_uri_finish(res);
                    callback(this, docModel, null);
                } catch (e) {
                    callback(this, null, e);
                }
            }));
    },

    open: function(parent, timestamp) {
        if (!this.defaultAppName)
            return;

        // Without a defaultApp, launch in the web browser,
        // otherwise use that system application
        try {
            if (this.defaultApp)
                this.defaultApp.launch_uris( [ this.uri ], null);
            else
                Gtk.show_uri_on_window(parent, this.uri, timestamp);
        } catch (e) {
            logError(e, 'Unable to show URI ' + this.uri);
        }
    },

    print: function(toplevel) {
        this.load(null, null, Lang.bind(this,
            function(doc, docModel, error) {
                if (error) {
                    logError(error, 'Unable to print document ' + this.uri);
                    return;
                }

                if (!this.canPrint(docModel))
                    return;

                let printOp = EvView.PrintOperation.new(docModel.get_document());

                printOp.connect('begin-print', Lang.bind(this,
                    function() {
                        this.emit('begin-print');
                    }));

                printOp.connect('done', Lang.bind(this,
                    function(op, res) {
                        if (res == Gtk.PrintOperationResult.ERROR) {
                            try {
                                printOp.get_error();
                            } catch (e) {
                                let errorDialog = new Gtk.MessageDialog ({ transient_for: toplevel,
                                                                           modal: true,
                                                                           destroy_with_parent: true,
                                                                           buttons: Gtk.ButtonsType.OK,
                                                                           message_type: Gtk.MessageType.ERROR,
                                                                           text: _("Failed to print document"),
                                                                           secondary_text: e.message });
                                errorDialog.connect ('response', Lang.bind(this,
                                    function() {
                                        errorDialog.destroy();
                                    }));
                                errorDialog.show();
                            }
                        }
                    }));

                let printNotification = new Notifications.PrintNotification(printOp, doc);

                printOp.run(toplevel);
            }));
    },

    getSourceLink: function() {
        // This should return an array of URI and source name
        log('Error: DocCommon implementations must override getSourceLink');
    },

    getWhere: function() {
        let retval = '';

        if (this.collection)
            retval = '{ ?urn nie:isPartOf <' + this.id + '> }';

        return retval;
    },
});
Signals.addSignalMethods(DocCommon.prototype);

var LocalDocument = new Lang.Class({
    Name: 'LocalDocument',
    Extends: DocCommon,

    _init: function(cursor) {
        this._failedThumbnailing = false;

        this.parent(cursor);

        this.sourceName = _("Local");

        if (this.mimeType) {
            let defaultApp = Gio.app_info_get_default_for_type(this.mimeType, true);
            let recommendedApp = null;

            let apps = Gio.app_info_get_recommended_for_type (this.mimeType);
            for (let i = 0; i < apps.length; i++) {
                if (apps[i].supports_uris ()) {
                    // Never offer to open in an archive handler
                    if (apps[i].get_id() == 'org.gnome.FileRoller.desktop')
                        continue;
                    if (defaultApp && apps[i].equal (defaultApp)) {
                        // Found the recommended app that's also the default
                        recommendedApp = apps[i];
                        break;
                    }
                    // Set the first recommendedApp as the default if
                    // they don't match
                    if (!recommendedApp)
                        recommendedApp = apps[i];
                }
            }

            this.defaultApp = recommendedApp;
        }

        if (this.defaultApp)
            this.defaultAppName = this.defaultApp.get_name();
    },

    populateFromCursor: function(cursor) {
        this.parent(cursor);
        this.uriToLoad = this.uri;
    },

    createThumbnail: function(callback) {
        GdPrivate.queue_thumbnail_job_for_file_async(this._file, Lang.bind(this,
            function(object, res) {
                let thumbnailed = false;

                try {
                    thumbnailed = GdPrivate.queue_thumbnail_job_for_file_finish(res);
                } catch (e) {
                    /* We don't care about reporting errors here, just fail the
                     * thumbnail.
                     */
                }

                callback(thumbnailed);
            }));
    },

    updateTypeDescription: function() {
        let description = '';

        if (this.collection)
            description = _("Collection");
        else if (this.mimeType)
            description = Gio.content_type_get_description(this.mimeType);

        this.typeDescription = description;
    },

    downloadImpl: function(localFile, cancellable, callback) {
        throw(new Error('LocalDocuments need not be downloaded'));
    },

    load: function(passwd, cancellable, callback) {
        Utils.debug('Loading ' + this.__name__ + ' ' + this.id);

        if (this.collection) {
            Mainloop.idle_add(Lang.bind(this,
                function() {
                    let error = new GLib.Error(Gio.IOErrorEnum,
                                               Gio.IOErrorEnum.NOT_SUPPORTED,
                                               "Collections can't be loaded");
                    callback(this, null, error);
                    return GLib.SOURCE_REMOVE;
                }));

            return;
        }

        this.loadLocal(passwd, cancellable, callback);
    },

    canEdit: function() {
        return this.collection;
    },

    canTrash: function() {
        return true;
    },

    trashImpl: function() {
        if (this.collection)
            return;

        let file = Gio.file_new_for_uri(this.uri);
        file.trash_async(GLib.PRIORITY_DEFAULT, null, Lang.bind(this,
            function(source, res) {
                try {
                    file.trash_finish(res);
                } catch(e) {
                    logError(e, 'Unable to trash ' + this.uri);
                }
            }));
    },

    getSourceLink: function() {
        if (this.collection)
            return [ null, this.sourceName ];

        let sourceLink = Gio.file_new_for_uri(this.uri).get_parent();
        let sourcePath = sourceLink.get_path();

        let uri = sourceLink.get_uri();
        return [ uri, sourcePath ];
    }
});

var DocumentManager = new Lang.Class({
    Name: 'DocumentManager',
    Extends: Manager.BaseManager,

    _init: function() {
        this.parent();

        this._loaderCancellable = null;

        this._activeCollection = null;
        this._collections = {};

        // a stack containing the collections which were used to
        // navigate to the active document or collection
        this._collectionPath = [];

        Application.changeMonitor.connect('changes-pending',
                                          Lang.bind(this, this._onChangesPending));
    },

    _onChangesPending: function(monitor, changes) {
        for (let idx in changes) {
            let changeEvent = changes[idx];

            if (changeEvent.type == ChangeMonitor.ChangeEventType.CHANGED) {
                let doc = this.getItemById(changeEvent.urn);

                if (doc)
                    doc.refresh();
            } else if (changeEvent.type == ChangeMonitor.ChangeEventType.CREATED) {
                this._onDocumentCreated(changeEvent.urn);
            } else if (changeEvent.type == ChangeMonitor.ChangeEventType.DELETED) {
                let doc = this.getItemById(changeEvent.urn);

                if (doc) {
                    doc.destroy();
                    this.removeItemById(changeEvent.urn);
                }
            }
        }
    },

    _onDocumentCreated: function(urn) {
        let job = new TrackerUtils.SingleItemJob(urn, Application.queryBuilder);
        job.run(Query.QueryFlags.NONE, Lang.bind(this,
            function(cursor) {
                if (!cursor)
                    return;

                this.addDocumentFromCursor(cursor);
            }));
    },

    createDocumentFromCursor: function(cursor) {
        let identifier = cursor.get_string(Query.QueryColumns.IDENTIFIER)[0];
        let doc;

        doc = new LocalDocument(cursor);

        return doc;
    },

    addDocumentFromCursor: function(cursor) {
        let id = cursor.get_string(Query.QueryColumns.URN)[0];
        let doc = this.getItemById(id);

        if (doc) {
            this.emit('item-added', doc);
        } else {
            doc = this.createDocumentFromCursor(cursor);
            this.addItem(doc);
        }

        return doc;
    },

    addItem: function(doc) {
        if (doc.collection) {
            let oldCollection = this._collections[doc.id];
            if (oldCollection)
                this.removeItem(oldCollection);

            this._collections[doc.id] = doc;
        }

        this.parent(doc);
    },

    clear: function() {
        this._collections = {};
        this._activeCollection = null;

        let items = this.getItems();
        for (let idx in items) {
            items[idx].destroy();
        };

        this.parent();
    },

    clearRowRefs: function() {
        let items = this.getItems();
        for (let idx in items) {
            items[idx].rowRefs = {};
        }
    },

    getActiveCollection: function() {
        return this._activeCollection;
    },

    getCollections: function() {
        return this._collections;
    },

    getWhere: function() {
        let retval = '';

        if (this._activeCollection)
            retval = this._activeCollection.getWhere();

        return retval;
    },

    _humanizeError: function(error) {
        let message = error.message;
        if (error.domain == Gio.IOErrorEnum) {
            switch (error.code) {
            case Gio.IOErrorEnum.NOT_SUPPORTED:
                message = _("You are using a preview of Books. Full viewing capabilities are coming soon!");
                break;
            default:
                break;
            }
        }

        let exception = new GLib.Error(error.domain, error.code, message);
        return exception;
    },

    _onDocumentLoadError: function(doc, error) {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return;

        if (error.matches(EvDocument.DocumentError, EvDocument.DocumentError.ENCRYPTED)) {
            this.emit('password-needed', doc);
            return;
        }

        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            logError(error, 'Unable to load document');
        else
            Utils.debug('Unable to load document' + doc.uri);

        // Translators: %s is the title of a document
        let message = _("Oops! Unable to load “%s”").format(doc.name);
        let exception = this._humanizeError(error);
        this.emit('load-error', doc, message, exception);
    },

    _onDocumentLoaded: function(doc, docModel, error) {
        this._loaderCancellable = null;

        if (error) {
            this._onDocumentLoadError(doc, error);
            return;
        }

        this.emit('load-finished', doc, docModel);
    },

    _requestPreview: function(doc) {
        let windowMode;
        if (EPUBView.isEpub(doc.mimeType)) {
            windowMode = WindowMode.WindowMode.PREVIEW_EPUB;
        } else {
            windowMode = WindowMode.WindowMode.PREVIEW_EV;
        }

        Application.modeController.setWindowMode(windowMode);
    },

    _loadActiveItem: function(passwd) {
        let doc = this.getActiveItem();

        this._loaderCancellable = new Gio.Cancellable();
        this._requestPreview(doc);
        this.emit('load-started', doc);
        doc.load(passwd, this._loaderCancellable, Lang.bind(this, this._onDocumentLoaded));
    },

    reloadActiveItem: function(passwd) {
        let doc = this.getActiveItem();

        if (!doc)
            return;

        if (doc.collection)
            return;

        // cleanup any state we have for previously loaded model
        this._clearActiveDocModel();

        this._loadActiveItem(passwd);
    },

    removeItemById: function(id) {
        if (this._collections[id]) {
            delete this._collections[id];
        }

        this.parent(id);
    },

    setActiveItem: function(doc) {
        let activeCollectionChanged = false;
        let activeDoc = this.getActiveItem();
        let retval = false;
        let startLoading = false;

        // Passing null is a way to go back to the current collection or
        // overview from the preview. However, you can't do that when you
        // are looking at a collection. Use activatePreviousCollection for
        // unwinding the collection stack.
        if (!doc) {
            if (activeDoc != this._activeCollection)
                doc = this._activeCollection;
            else
                return false;
        }

        // cleanup any state we have for previously loaded model
        this._clearActiveDocModel();

        // If doc is null then we are going back to the overview from
        // the preview.
        if (doc) {
            if (doc.collection) {
                // If doc is the active collection then we are going back to the
                // collection from the preview.
                if (doc != this._activeCollection) {
                    this._collectionPath.push(this._activeCollection);
                    this._activeCollection = doc;
                    activeCollectionChanged = true;
                }
            } else {
                startLoading = true;
            }
        }

        retval = this.parent(doc);

        if (retval && activeCollectionChanged)
            this.emit('active-collection-changed', this._activeCollection);

        if (retval && startLoading) {
            let recentManager = Gtk.RecentManager.get_default();
            recentManager.add_item(doc.uri);

            this._loadActiveItem(null);
        }

        return retval;
    },

    activatePreviousCollection: function() {
        this._clearActiveDocModel();

        let collection = this._collectionPath.pop();
        this._activeCollection = collection;
        Manager.BaseManager.prototype.setActiveItem.call(this, collection);
        this.emit('active-collection-changed', this._activeCollection);
    },

    _clearActiveDocModel: function() {
        // cancel any pending load operation
        if (this._loaderCancellable) {
            this._loaderCancellable.cancel();
            this._loaderCancellable = null;
        }
    }
});
