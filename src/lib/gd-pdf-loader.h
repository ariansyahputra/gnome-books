/*
 * Copyright (C) 2011 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA
 * 02111-1307, USA.
 *
 * Authors: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

#ifndef __GD_PDF_LOADER_H__
#define __GD_PDF_LOADER_H__

#include <glib-object.h>
#include <gio/gio.h>
#include <evince-document.h>
#include <gdata/gdata.h>

G_BEGIN_DECLS

void gd_pdf_loader_load_uri_async (const gchar *uri,
                                   GCancellable *cancellable,
                                   GAsyncReadyCallback callback,
                                   gpointer user_data);
EvDocument *gd_pdf_loader_load_uri_finish (GAsyncResult *res,
                                           GError **error);

void gd_pdf_loader_load_entry_async (GDataEntry *entry,
                                     GDataDocumentsService *service,
                                     GCancellable *cancellable,
                                     GAsyncReadyCallback callback,
                                     gpointer user_data);
EvDocument *gd_pdf_loader_load_entry_finish (GAsyncResult *res,
                                             GError **error);

G_END_DECLS

#endif /* __GD_PDF_LOADER_H__ */
