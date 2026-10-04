import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseTilePhoto } from './photos';

const mock = vi.hoisted(() => ({ platform: { OS: 'ios' }, picker: vi.fn(), manipulate: vi.fn(), render: vi.fn(), resize: vi.fn(), save: vi.fn(), store: vi.fn(), contextRelease: vi.fn(), imageRelease: vi.fn() }));
vi.mock('react-native', () => ({ Platform: mock.platform }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mock.picker, UIImagePickerPresentationStyle: { FULL_SCREEN: 'fullScreen' } }));
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: mock.manipulate }, SaveFormat: { JPEG: 'jpeg' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'local-photo' }));
vi.mock('../data/storage', () => ({ saveAsset: mock.store }));
beforeEach(() => {
  vi.resetAllMocks(); mock.platform.OS = 'ios';
  mock.picker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///native-crop.jpg', width: 2000, height: 2000 }] });
  mock.manipulate.mockReturnValue({ resize: mock.resize, renderAsync: mock.render, release: mock.contextRelease });
  mock.render.mockResolvedValue({ saveAsync: mock.save, release: mock.imageRelease });
  mock.save.mockResolvedValue({ uri: 'file:///normalized-photo.jpg', width: 1600, height: 1600 });
});
describe('local photo selection', () => {
  it.each(['ios', 'android'])('uses the native square crop result on %s and saves it locally with no extra zoom', async platform => {
    mock.platform.OS = platform;
    const photo = await chooseTilePhoto();
    expect(mock.picker).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: true, aspect: [1, 1], mediaTypes: ['images'], allowsMultipleSelection: false }));
    expect(mock.manipulate).toHaveBeenCalledWith('file:///native-crop.jpg');
    expect(mock.resize).toHaveBeenCalledWith({ width: 1600 });
    expect(mock.store).toHaveBeenCalledWith('local-photo', 'file:///normalized-photo.jpg');
    expect(photo).toEqual({ kind: 'photo', assetId: 'local-photo', zoom: 1, x: 0, y: 0 });
    expect(mock.contextRelease).toHaveBeenCalledOnce(); expect(mock.imageRelease).toHaveBeenCalledOnce();
  });
  it('lets web use its in-app cropper and avoids upscaling small images', async () => {
    mock.platform.OS = 'web'; mock.picker.mockResolvedValue({ canceled: false, assets: [{ uri: 'blob:photo', width: 800, height: 600 }] });
    await chooseTilePhoto(); expect(mock.picker).toHaveBeenCalledWith(expect.objectContaining({ allowsEditing: false })); expect(mock.resize).not.toHaveBeenCalled();
  });
  it('does not save or replace anything when the native picker or cropper is cancelled', async () => {
    mock.picker.mockResolvedValue({ canceled: true, assets: null });
    expect(await chooseTilePhoto()).toBeNull(); expect(mock.manipulate).not.toHaveBeenCalled(); expect(mock.store).not.toHaveBeenCalled();
  });
  it('releases image resources if local saving fails and rejects unreadable assets', async () => {
    mock.store.mockRejectedValueOnce(new Error('Storage full'));
    await expect(chooseTilePhoto()).rejects.toThrow('Storage full');
    expect(mock.contextRelease).toHaveBeenCalledOnce(); expect(mock.imageRelease).toHaveBeenCalledOnce();
    mock.picker.mockResolvedValue({ canceled: false, assets: [{ uri: 'bad', width: 0, height: 0 }] });
    await expect(chooseTilePhoto()).rejects.toThrow('could not be opened'); expect(mock.store).toHaveBeenCalledTimes(1);
  });
});
