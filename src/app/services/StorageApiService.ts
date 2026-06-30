import { getRuntimeConfig } from '@/app/init';

/**
 * Centralized accessor for the DApp runtime parameters coming from the Signet container
 * or from the local simulator (see init.tsx).
 */
function getApiBaseUrl(): string {
    const { apiBaseUrl } = getRuntimeConfig();
    return apiBaseUrl;
}

/**
 * Get the API token for Bearer authentication
 */
function getApiToken(): string | undefined {
    // Never log the token - this code ships in the DApp bundle and runs in the
    // production Signet WebView, where console output can be captured.
    return getRuntimeConfig().apiToken;
}

/**
 * Build headers with Bearer token if available
 */
function getAuthHeaders(): HeadersInit {
    const token = getApiToken();
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

/**
 * Upload a file via the secure API service
 * This function should be called from client-side components
 * groupId should be the Profile DID obtained via Signet Security Interface.
 */
export async function uploadFile(file: File, groupId?: string, keyvalues?: Record<string, unknown>) {
    const baseUrl = getApiBaseUrl();
    try {
        const formData = new FormData();
        formData.append('file', file);
        if (groupId) {
            formData.append('groupId', groupId);
        }
        if (keyvalues) {
            formData.append('keyvalues', JSON.stringify(keyvalues));
        }

        const token = getApiToken();
        const headers: HeadersInit = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${baseUrl}/api/files/upload`, {
            method: 'POST',
            headers,
            body: formData,
        });

        if (response.status === 402) {
            throw new Error('STORAGE_PAYMENT_REQUIRED');
        }
        if (response.status === 403) {
            throw new Error('SUBSCRIPTION_INACTIVE');
        }
        if (!response.ok) {
            // propagate backend error text if available
            const err = await safeJson(response);
            throw new Error((err as { error?: string } | undefined)?.error || 'Failed to upload file');
        }

        const result = await response.json();
        return result;
    } catch (error) {
        // Re-throw billing errors so callers can handle them with specific UI
        if (error instanceof Error &&
            (error.message === 'STORAGE_PAYMENT_REQUIRED' || error.message === 'SUBSCRIPTION_INACTIVE')) {
            throw error;
        }
        console.error('Upload error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export type ListFilesParams = {
    name?: string;
    groupId?: string;
    noGroup?: boolean;
    cid?: string;
    mimeType?: string;
    keyvalues?: Record<string, unknown>;
    order?: 'ASC' | 'DESC';
    limit?: number;
    cidPending?: boolean;
    pageToken?: string;
};

export type FileListItem = {
    id: string;
    name: string | null;
    cid: 'pending' | string;
    size: number;
    numberOfFiles: number;
    mimeType: string;
    groupId: string;
    updatedAt: string;
    createdAt: string;
    keyvalues?: Record<string, unknown>;
};

export type FileListResponse = {
    files: FileListItem[];
    next_page_token: string;
};

/**
 * List files from the secure API service with full filter support
 */
export async function listFiles(params: ListFilesParams = {}): Promise<FileListResponse> {
    const baseUrl = getApiBaseUrl();
    const qs = new URLSearchParams();

    if (params.name) qs.set('name', params.name);
    if (params.groupId) qs.set('groupId', params.groupId);
    if (params.noGroup === true) qs.set('noGroup', 'true');
    if (params.cid) qs.set('cid', params.cid);
    if (params.mimeType) qs.set('mimeType', params.mimeType);
    if (params.keyvalues) qs.set('keyvalues', JSON.stringify(params.keyvalues));
    if (params.order) qs.set('order', params.order);
    if (typeof params.limit === 'number') qs.set('limit', String(params.limit));
    if (params.cidPending === true) qs.set('cidPending', 'true');
    if (params.pageToken) qs.set('pageToken', params.pageToken);

    const url = `${baseUrl}/api/files/list${qs.toString() ? `?${qs.toString()}` : ''}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: getAuthHeaders()
    });
    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to list files from API service';
        throw new Error(message);
    }
    return response.json();
}

/**
 * Delete a file from the secure API service
 */
export async function deleteFile(fileId: string) {
    const baseUrl = getApiBaseUrl();
    try {
        const response = await fetch(`${baseUrl}/api/files/delete`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
            body: JSON.stringify({ fileId }),
        });

        if (!response.ok) {
            throw new Error('Failed to delete file from API service');
        }

        return await response.json();
    } catch (error) {
        console.error('Delete file error:', error);
        throw error;
    }
}

/**
 * GROUPS API
 * Backed by /api/group route on the server
 */

/**
 * Create a new group
 */
export async function createGroup(groupName: string) {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/files/group`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: groupName }),
    });
    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to create group';
        throw new Error(message);
    }
    return response.json();
}

/**
 * Get a single group by id
 */
export async function getGroup(groupId: string) {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/files/group?groupId=${encodeURIComponent(groupId)}`, {
        method: 'GET',
        headers: getAuthHeaders(),
    });
    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to fetch group';
        throw new Error(message);
    }
    return response.json();
}

/**
 * List groups, optionally filter by name
 */
export async function listGroups(name?: string) {
    const baseUrl = getApiBaseUrl();
    const qs = name ? `?name=${encodeURIComponent(name)}` : '';
    const headers = getAuthHeaders();

    const response = await fetch(`${baseUrl}/api/files/group${qs}`, {
        method: 'GET',
        headers: headers
    });
    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to list groups';
        throw new Error(message);
    }
    return response.json();
}

/**
 * Update a group's name
 */
export async function updateGroup(groupId: string, name: string) {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/files/group`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ groupId, name }),
    });
    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to update group';
        throw new Error(message);
    }
    return response.json();
}

/**
 * Delete a group by id
 */
export async function deleteGroup(groupId: string) {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/files/group`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        body: JSON.stringify({ groupId }),
    });
    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to delete group';
        throw new Error(message);
    }
    return response.json();
}

/**
 * Add file IDs to a group
 */
export async function addFilesToGroup(groupId: string, files: string[]) {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/files/group`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ action: 'addFiles', groupId, files }),
    });
    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to add files to group';
        throw new Error(message);
    }
    return response.json();
}

/**
 * Remove file IDs from a group
 */
export async function removeFilesFromGroup(groupId: string, files: string[]) {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/files/group`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ action: 'removeFiles', groupId, files }),
    });
    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to remove files from group';
        throw new Error(message);
    }
    return response.json();
}

/**
 * Get a temporary access link for a CID
 */
export async function getFileUrl(cid: string, expires?: number): Promise<string> {
    const baseUrl = getApiBaseUrl();
    const qs = new URLSearchParams();
    qs.set('cid', cid);
    if (expires) qs.set('expires', String(expires));

    const url = `${baseUrl}/api/files/link?${qs.toString()}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: getAuthHeaders(),
    });

    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to get file link';
        throw new Error(message);
    }

    const result = await response.json();
    return result.data; // link/route.ts returns { success: true, data: url }
}

/**
 * Get file content from storage by CID
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getFileContent(cid: string): Promise<{ data: any; contentType: string }> {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/files/get?cid=${encodeURIComponent(cid)}`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: getAuthHeaders(),
    });

    if (!response.ok) {
        const errorData = await safeJson(response);
        const message =
            (errorData && typeof errorData === 'object' && !Array.isArray(errorData) && 'error' in errorData && typeof (errorData as { error?: unknown }).error === 'string'
                ? (errorData as { error?: string }).error
                : undefined) ||
            'Failed to get file content';
        throw new Error(message);
    }

    const result = await response.json();
    return {
        data: result.data,
        contentType: result.contentType
    }; // get/route.ts returns { success: true, data: fileData.data, contentType: fileData.contentType }
}

/**
 * Safely parse JSON from a Response. Returns undefined on failure.
 */
type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

async function safeJson<T extends JsonValue = JsonValue>(response: Response): Promise<T | undefined> {
    try {
        return (await response.json()) as T;
    } catch {
        return undefined;
    }
}