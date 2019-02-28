project(
  'gnome-books', 'c',
  version: '3.31.90',
  license: 'GPL2+',
  default_options: 'buildtype=debugoptimized',
  meson_version: '>= 0.42.0'
)

books_version = meson.project_version()

books_ns = 'Gd'
books_private_ns = books_ns + 'Private'

books_api_version = '1.0'
books_gir_version = '1.0'

books_prefix = get_option('prefix')
books_bindir = join_paths(books_prefix, get_option('bindir'))
books_datadir = join_paths(books_prefix, get_option('datadir'))
books_libdir = join_paths(books_prefix, get_option('libdir'))
books_mandir = join_paths(books_prefix, get_option('mandir'))

books_pkgdatadir = join_paths(books_datadir, meson.project_name())
books_pkglibdir = join_paths(books_libdir, meson.project_name())

books_schemadir = join_paths(books_datadir, 'glib-2.0', 'schemas')

if not get_option('buildtype').contains('plain')
  run_command('git', '-C', meson.source_root(), 'submodule', 'update', '--init', '--recursive')
endif

cc = meson.get_compiler('c')

config_h = configuration_data()

# defines
set_defines = [
  # package
  ['PACKAGE_NAME', meson.project_name()],
  ['PACKAGE_VERSION', books_version],
  # i18n
  ['GETTEXT_PACKAGE', meson.project_name()]
]

foreach define: set_defines
  config_h.set_quoted(define[0], define[1])
endforeach

# compiler flags
add_project_arguments('-DHAVE_CONFIG_H', language: 'c')

evince_req_version = '>= 3.13.3'
tracker_req_version = '>= 0.17.3'

gdk_pixbuf_dep = dependency('gdk-pixbuf-2.0', version: '>= 2.39.1')
extra_gdk_pixbuf_loaders_dir = join_paths (books_pkglibdir, 'gdk-pixbuf', gdk_pixbuf_dep.get_pkgconfig_variable('gdk_pixbuf_binary_version'))

gjs_dep = dependency('gjs-1.0', version: '>= 1.48.0')
gjs_console = gjs_dep.get_pkgconfig_variable('gjs_console')

books_deps = [
  gjs_dep,
  dependency('evince-document-3.0', version: evince_req_version),
  dependency('evince-view-3.0', version: evince_req_version),
  dependency('glib-2.0', version: '>= 2.39.3'),
  dependency('gnome-desktop-3.0'),
  dependency('gobject-introspection-1.0', version: '>= 1.31.6'),
  dependency('gtk+-3.0', version: '>= 3.22.15'),
  dependency('tracker-control-2.0', version: tracker_req_version),
  dependency('tracker-sparql-2.0', version: tracker_req_version),
  dependency('webkit2gtk-4.0', version: '>= 2.6.0'),
  cc.find_library('m')
]

# we just check their existence for gir
dependency('libgepub-0.6')

# Although GTK+ 3.10 includes hi-dpi functionality, it does not require a cairo with
# cairo_surface_set_device_scale(), which we also need if we're to support hi-dpi,
# so we need check for that explicity.
config_h.set(
  'HAVE_CAIRO_SURFACE_SET_DEVICE_SCALE',
  cc.has_function('cairo_surface_set_device_scale', dependencies: books_deps)
)

libgd = subproject(
  'libgd',
  default_options: [
    'pkgdatadir=' + books_pkgdatadir,
    'pkglibdir=' + books_pkglibdir,
    'static=false',
    'with-gtk-hacks=true',
    'with-introspection=true',
    'with-main-view=true',
    'with-notification=true',
    'with-tagged-entry=true'
  ]
)
books_deps += libgd.get_variable('libgd_dep')

configure_file(
  output: 'config.h',
  configuration: config_h
)

gnome = import('gnome')
i18n = import('i18n')
pkg = import('pkgconfig')

po_dir = join_paths(meson.source_root(), 'po')

top_inc = include_directories('.')

subdir('src')
subdir('data')
subdir('po')

if get_option('documentation')
  subdir('man')
endif

meson.add_install_script(
  'meson_post_install.py',
  books_datadir,
  books_bindir
)

output = '\n        ' + meson.project_name() + ' ' + books_version + '\n'
output += '        ======================\n\n'
output += '        prefix:    ' + books_prefix + '\n'
output += '        compiler:  ' + cc.get_id() + '\n'
message(output)
