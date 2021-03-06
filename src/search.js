/*
 * Copyright (c) 2011, 2012, 2014, 2015 Red Hat, Inc.
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

const Application = imports.application;
const Documents = imports.documents;
const Manager = imports.manager;
const Query = imports.query;

const Lang = imports.lang;
const Signals = imports.signals;

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Tracker = imports.gi.Tracker;
const _ = imports.gettext.gettext;
const C_ = imports.gettext.pgettext;

function initSearch(context) {
    context.documentManager = new Documents.DocumentManager();
    context.sourceManager = new SourceManager(context);
    context.searchMatchManager = new SearchMatchManager(context);
    context.searchTypeManager = new SearchTypeManager(context);
    context.searchController = new SearchController(context);
    context.queryBuilder = new Query.QueryBuilder(context);
};

const SearchState = new Lang.Class({
    Name: 'SearchState',

    _init: function(searchMatch, searchType, source, str) {
        this.searchMatch = searchMatch;
        this.searchType = searchType;
        this.source = source;
        this.str = str;
    }
});

const SearchController = new Lang.Class({
    Name: 'SearchController',

    _init: function() {
        this._string = '';
    },

    setString: function(string) {
        if (this._string == string)
            return;

        this._string = string;
        this.emit('search-string-changed', this._string);
    },

    getString: function() {
        return this._string;
    },

    getTerms: function() {
        let escapedStr = Tracker.sparql_escape_string(this._string);
        let [tokens, ] = GLib.str_tokenize_and_fold(escapedStr, null);
        return tokens;
    }
});
Signals.addSignalMethods(SearchController.prototype);

const SearchType = new Lang.Class({
    Name: 'SearchType',

    _init: function(params) {
        this.id = params.id;
        this.name = params.name;
        this._filter = (params.filter) ? (params.filter) : '(true)';
        this._where = (params.where) ? (params.where) : '';
    },

    getFilter: function() {
        return this._filter;
    },

    getWhere: function() {
        return this._where;
    }
});

var SearchTypeStock = {
    ALL: 'all',
    COLLECTIONS: 'collections',
    EBOOKS: 'ebooks',
    COMICS: 'comics'
};

const SearchTypeManager = new Lang.Class({
    Name: 'SearchTypeManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        // Translators: "Type" refers to a search filter on the document type
        // (e-Books, Comics, ...)
        this.parent(C_("Search Filter", "Type"), 'search-type', context);

        this.addItem(new SearchType({ id: SearchTypeStock.ALL,
                                      name: _("All") }));
        this.addItem(new SearchType({ id: SearchTypeStock.COLLECTIONS,
                                      name: _("Collections"),
                                      filter: 'fn:starts-with(nao:identifier(?urn), \"gb:collection\")',
                                      where: '?urn rdf:type nfo:DataContainer .' }));
        //FIXME we need to remove all the non-Comics PDFs here

        this.addItem(new SearchType({ id: SearchTypeStock.EBOOKS,
                                      name: _("e-Books"),
                                      filter: '(nie:mimeType(?urn) IN (\"application/epub+zip\", \"application/x-mobipocket-ebook\", \"application/x-fictionbook+xml\", \"application/x-zip-compressed-fb2\", \"image/vnd.djvu+multipage\"))',
                                      where: '?urn rdf:type nfo:EBook .' }));
        this.addItem(new SearchType({ id: SearchTypeStock.COMICS,
                                      name: _("Comics"),
                                      filter: '(nie:mimeType(?urn) IN (\"application/x-cbr\", \"application/vnd.comicbook-rar\", \"application/x-cbz\", \"application/vnd.comicbook+zip\", \"application/x-cbt\", \"application/x-cb7\"))',
                                      where: '?urn rdf:type nfo:EBook .' }));


        this.setActiveItemById(SearchTypeStock.ALL);
    },

    getCurrentTypes: function() {
        let activeItem = this.getActiveItem();

        if (activeItem.id == SearchTypeStock.ALL)
            return this.getAllTypes();

        return [ activeItem ];
    },

    getDocumentTypes: function() {
        let types = [];

        types.push(this.getItemById(SearchTypeStock.EBOOKS));
        types.push(this.getItemById(SearchTypeStock.COMICS));

        return types;
    },

    getAllTypes: function() {
        let types = [];

        this.forEachItem(function(item) {
            if (item.id != SearchTypeStock.ALL)
                types.push(item);
            });

        return types;
    }
});

var SearchMatchStock = {
    ALL: 'all',
    TITLE: 'title',
    AUTHOR: 'author',
    CONTENT: 'content'
};

const SearchMatch = new Lang.Class({
    Name: 'SearchMatch',

    _init: function(params) {
        this.id = params.id;
        this.name = params.name;
        this._term = '';
    },

    setFilterTerm: function(term) {
        this._term = term;
    },

    getFilter: function() {
        if (this.id == SearchMatchStock.TITLE)
            return ('fn:contains ' +
                    '(tracker:unaccent(tracker:case-fold' +
                    '(tracker:coalesce(nie:title(?urn), nfo:fileName(?urn)))), ' +
                    '"%s") || ' +
                    'fn:contains ' +
                    '(tracker:case-fold' +
                    '(tracker:coalesce(nie:title(?urn), nfo:fileName(?urn))), ' +
                    '"%s")').format(this._term, this._term);
        if (this.id == SearchMatchStock.AUTHOR)
            return ('fn:contains ' +
                    '(tracker:unaccent(tracker:case-fold' +
                    '(tracker:coalesce(nco:fullname(?creator), nco:fullname(?publisher)))), ' +
                    '"%s") || ' +
                    'fn:contains ' +
                    '(tracker:case-fold' +
                    '(tracker:coalesce(nco:fullname(?creator), nco:fullname(?publisher))), ' +
                    '"%s")').format(this._term, this._term);
        if (this.id == SearchMatchStock.CONTENT)
            return '(false)';
        return '';
    }
});

const SearchMatchManager = new Lang.Class({
    Name: 'SearchMatchManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        // Translators: this is a verb that refers to "All", "Title", "Author",
        // and "Content" as in "Match All", "Match Title", "Match Author", and
        // "Match Content"
        this.parent(_("Match"), 'search-match', context);

        this.addItem(new SearchMatch({ id: SearchMatchStock.ALL,
                                       name: _("All") }));
        this.addItem(new SearchMatch({ id: SearchMatchStock.TITLE,
        //Translators: "Title" refers to "Match Title" when searching
                                       name: C_("Search Filter", "Title") }));
        this.addItem(new SearchMatch({ id: SearchMatchStock.AUTHOR,
        //Translators: "Author" refers to "Match Author" when searching
                                       name: C_("Search Filter", "Author") }));
        this.addItem(new SearchMatch({ id: SearchMatchStock.CONTENT,
        //Translators: "Content" refers to "Match Content" when searching
                                       name: C_("Search Filter", "Content") }));

        this.setActiveItemById(SearchMatchStock.ALL);
    },

    getWhere: function() {
        let item = this.getActiveItem();
        if (item.id != SearchMatchStock.ALL &&
            item.id != SearchMatchStock.CONTENT)
            return '';

        let terms = this.context.searchController.getTerms();
        if (!terms.length)
            return '';

        let ftsterms = [];
        for (let i = 0; i < terms.length; i++) {
            if (terms[i].length > 0)
                ftsterms.push(terms[i] + '*');
        }

        return '?urn fts:match \'%s\' . '.format(ftsterms.join(' '));
    },

    getFilter: function(flags) {
        if ((flags & Query.QueryFlags.SEARCH) == 0)
            return '(true)';

        let terms = this.context.searchController.getTerms();
        let filters = [];

        for (let i = 0; i < terms.length; i++) {
            this.forEachItem(function(item) {
                item.setFilterTerm(terms[i]);
            });

            let filter;
            let item = this.getActiveItem();

            if (item.id == SearchMatchStock.ALL)
                filter = this.getAllFilter();
            else
                filter = item.getFilter();

            filters.push(filter);
        }
        return filters.length ? '( ' + filters.join(' && ') + ')' : '(true)';
    }
});

var SearchSourceStock = {
    ALL: 'all',
    LOCAL: 'local'
};

const TRACKER_SCHEMA = 'org.freedesktop.Tracker.Miner.Files';
const TRACKER_KEY_RECURSIVE_DIRECTORIES = 'index-recursive-directories';

const Source = new Lang.Class({
    Name: 'Source',

    _init: function(params) {
        this.id = null;
        this.name = null;
        this.icon = null;

        this.id = params.id;
        this.name = params.name;

        this.builtin = params.builtin;
    },

    _getTrackerLocations: function() {
        let settings = new Gio.Settings({ schema_id: TRACKER_SCHEMA });
        let locations = settings.get_strv(TRACKER_KEY_RECURSIVE_DIRECTORIES);
        let files = [];

        locations.forEach(Lang.bind(this,
            function(location) {
                // ignore special XDG placeholders, since we handle those internally
                if (location[0] == '&' || location[0] == '$')
                    return;

                let trackerFile = Gio.file_new_for_commandline_arg(location);

                // also ignore XDG locations if they are present with their full path
                for (let idx = 0; idx < GLib.UserDirectory.N_DIRECTORIES; idx++) {
                    let path = GLib.get_user_special_dir(idx);
                    if (!path)
                        continue;

                    let file = Gio.file_new_for_path(path);
                    if (trackerFile.equal(file))
                        return;
                }

                files.push(trackerFile);
            }));

        return files;
    },

    _getBuiltinLocations: function() {
        let files = [];
        let xdgDirs = [GLib.UserDirectory.DIRECTORY_DESKTOP,
                       GLib.UserDirectory.DIRECTORY_DOCUMENTS,
                       GLib.UserDirectory.DIRECTORY_DOWNLOAD];

        xdgDirs.forEach(Lang.bind(this,
            function(dir) {
                let path = GLib.get_user_special_dir(dir);
                if (path)
                    files.push(Gio.file_new_for_path(path));
            }));

        return files;
    },

    _buildFilterLocal: function() {
        let locations = this._getBuiltinLocations();
        locations = locations.concat(this._getTrackerLocations());

        let filters = [];
        locations.forEach(Lang.bind(this,
            function(location) {
                filters.push('(fn:contains (nie:url(?urn), "%s"))'.format(location.get_uri()));
            }));

        filters.push('(fn:starts-with (nao:identifier(?urn), "gb:collection:local:"))');

        return '(' + filters.join(' || ') + ')';
    },

    getFilter: function() {
        let filters = [];

        if (this.id == SearchSourceStock.LOCAL ||
            this.id == SearchSourceStock.ALL) {
            filters.push(this._buildFilterLocal());
        } else {
            filters.push(this._buildFilterResource());
        }

        return '(' + filters.join(' || ') + ')';
    },

    _buildFilterResource: function() {
        let filter = '(false)';

        if (!this.builtin)
            filter = ('(nie:dataSource(?urn) = "%s")').format(this.id);

        return filter;
    }
});

const SourceManager = new Lang.Class({
    Name: 'SourceManager',
    Extends: Manager.BaseManager,

    _init: function(context) {
        this.parent(_("Sources"), 'search-source', context);

        let source = new Source({ id: SearchSourceStock.ALL,
        // Translators: this refers to documents
                                  name: _("All"),
                                  builtin: true });
        this.addItem(source);

        source = new Source({ id: SearchSourceStock.LOCAL,
        // Translators: this refers to local documents
                              name: _("Local"),
                              builtin: true });
        this.addItem(source);

        this.setActiveItemById(SearchSourceStock.ALL);
    },

    getFilter: function(flags) {
        let item;

        if (flags & Query.QueryFlags.SEARCH)
            item = this.getActiveItem();
        else
            item = this.getItemById(SearchSourceStock.ALL);

        let filter;

        if (item.id == SearchSourceStock.ALL)
            filter = this.getAllFilter();
        else
            filter = item.getFilter();

        return filter;
    },
});

var OFFSET_STEP = 50;

const OffsetController = new Lang.Class({
    Name: 'OffsetController',

    _init: function() {
        this._offset = 0;
        this._itemCount = 0;
    },

    // to be called by the view
    increaseOffset: function() {
        this._offset += OFFSET_STEP;
        this.emit('offset-changed', this._offset);
    },

    // to be called by the model
    resetItemCount: function() {
        let query = this.getQuery();

        Application.connectionQueue.add
            (query.sparql, null, Lang.bind(this,
                function(object, res) {
                    let cursor = null;
                    try {
                        cursor = object.query_finish(res);
                    } catch (e) {
                        logError(e, 'Unable to execute count query');
                        return;
                    }

                    cursor.next_async(null, Lang.bind(this,
                        function(object, res) {
                            let valid = object.next_finish(res);

                            if (valid) {
                                this._itemCount = cursor.get_integer(0);
                                this.emit('item-count-changed', this._itemCount);
                            }

                            cursor.close();
                        }));
                }));
    },

    getQuery: function() {
        log('Error: OffsetController implementations must override getQuery');
    },

    // to be called by the model
    resetOffset: function() {
        this._offset = 0;
    },

    getItemCount: function() {
        return this._itemCount;
    },

    getRemainingDocs: function() {
        return (this._itemCount - (this._offset + OFFSET_STEP));
    },

    getOffsetStep: function() {
        return OFFSET_STEP;
    },

    getOffset: function() {
        return this._offset;
    }
});
Signals.addSignalMethods(OffsetController.prototype);

var OffsetCollectionsController = new Lang.Class({
    Name: 'OffsetCollectionsController',
    Extends: OffsetController,

    _init: function() {
        this.parent();
    },

    getQuery: function() {
        let activeCollection = Application.documentManager.getActiveCollection();
        let flags;

        if (activeCollection)
            flags = Query.QueryFlags.NONE;
        else
            flags = Query.QueryFlags.COLLECTIONS;

        return Application.queryBuilder.buildCountQuery(flags);
    }
});

var OffsetDocumentsController = new Lang.Class({
    Name: 'OffsetDocumentsController',
    Extends: OffsetController,

    _init: function() {
        this.parent();
    },

    getQuery: function() {
        return Application.queryBuilder.buildCountQuery(Query.QueryFlags.DOCUMENTS);
    }
});

var OffsetSearchController = new Lang.Class({
    Name: 'OffsetSearchController',
    Extends: OffsetController,

    _init: function() {
        this.parent();
    },

    getQuery: function() {
        return Application.queryBuilder.buildCountQuery(Query.QueryFlags.SEARCH);
    }
});
