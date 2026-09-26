import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User, signOut } from "firebase/auth";
import { auth } from "./firebase";

// In-memory token cache ONLY (strictly never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

const driveProvider = new GoogleAuthProvider();
// Request Google Drive readonly scope as configured in OAuth setup
driveProvider.addScope("https://www.googleapis.com/auth/drive.readonly");
driveProvider.setCustomParameters({
  prompt: "consent",
  access_type: "online",
});

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  md5Checksum?: string;
  webViewLink?: string;
  webContentLink?: string;
  parents?: string[];
}

export interface DriveFolder {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
  files: DriveFile[];
}

export interface DriveScanResult {
  folders: DriveFolder[];
  standaloneFiles: DriveFile[];
  totalFiles: number;
  scannedAt: string;
}

// Clear memory cache when user logs out
onAuthStateChanged(auth, (user) => {
  if (!user && !isSigningIn) {
    cachedAccessToken = null;
  }
});

export const getCachedAccessToken = (): string | null => cachedAccessToken;

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

/**
 * Sign in with Google Popup and obtain Drive OAuth Access Token
 */
export async function googleSignIn(): Promise<{ user: User; accessToken: string } | null> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, driveProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Google Drive access token was not returned by OAuth provider.");
    }
    cachedAccessToken = credential.accessToken;
    return {
      user: result.user,
      accessToken: cachedAccessToken,
    };
  } catch (error: any) {
    console.error("Google Drive OAuth Sign-in error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
}

export async function googleSignOut(): Promise<void> {
  await signOut(auth);
  cachedAccessToken = null;
}

/**
 * Queries Google Drive API v3 to locate folder(s) named "onnx" (case-insensitive)
 * and retrieves all files within those folders, plus any top-level .onnx model files.
 */
export async function scanDriveForOnnx(token: string): Promise<DriveScanResult> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  // 1. Search for folders with name 'onnx' or 'ONNX'
  const folderQueries = [
    "mimeType = 'application/vnd.google-apps.folder' and name = 'onnx' and trashed = false",
    "mimeType = 'application/vnd.google-apps.folder' and name = 'ONNX' and trashed = false",
    "mimeType = 'application/vnd.google-apps.folder' and name contains 'onnx' and trashed = false",
  ];

  const foundFoldersMap = new Map<string, DriveFolder>();

  for (const q of folderQueries) {
    const folderUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      q
    )}&fields=files(id,name,mimeType,modifiedTime,createdTime,webViewLink)&pageSize=20`;
    
    try {
      const res = await fetch(folderUrl, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.files && Array.isArray(data.files)) {
          for (const folder of data.files) {
            if (!foundFoldersMap.has(folder.id)) {
              foundFoldersMap.set(folder.id, {
                id: folder.id,
                name: folder.name,
                modifiedTime: folder.modifiedTime,
                webViewLink: folder.webViewLink,
                files: [],
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn("Folder search query failed:", q, err);
    }
  }

  // 2. For each discovered folder, fetch its files
  const folders = Array.from(foundFoldersMap.values());
  let allFilesInFoldersIds = new Set<string>();

  for (const folder of folders) {
    const filesUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `'${folder.id}' in parents and trashed = false`
    )}&fields=files(id,name,mimeType,size,modifiedTime,createdTime,md5Checksum,webViewLink,webContentLink,parents)&pageSize=100`;

    try {
      const res = await fetch(filesUrl, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.files && Array.isArray(data.files)) {
          folder.files = data.files;
          data.files.forEach((f: DriveFile) => allFilesInFoldersIds.add(f.id));
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch files for folder ${folder.name} (${folder.id}):`, err);
    }
  }

  // 3. Scan for any standalone .onnx files across drive
  const standaloneFiles: DriveFile[] = [];
  const modelQuery = "(name contains '.onnx' or name contains 'onnx') and mimeType != 'application/vnd.google-apps.folder' and trashed = false";
  const modelUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    modelQuery
  )}&fields=files(id,name,mimeType,size,modifiedTime,createdTime,md5Checksum,webViewLink,webContentLink,parents)&pageSize=50`;

  try {
    const res = await fetch(modelUrl, { headers });
    if (res.ok) {
      const data = await res.json();
      if (data.files && Array.isArray(data.files)) {
        for (const file of data.files) {
          // If not already included inside one of the onnx folders, record as standalone
          if (!allFilesInFoldersIds.has(file.id)) {
            standaloneFiles.push(file);
          }
        }
      }
    }
  } catch (err) {
    console.warn("Failed to search standalone .onnx files:", err);
  }

  const totalFilesInFolders = folders.reduce((sum, f) => sum + f.files.length, 0);

  return {
    folders,
    standaloneFiles,
    totalFiles: totalFilesInFolders + standaloneFiles.length,
    scannedAt: new Date().toISOString(),
  };
}
