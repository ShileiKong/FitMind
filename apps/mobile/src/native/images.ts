import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Directory, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
export interface LocalAttachment {
  uri: string;
  kind: 'image' | 'audio';
  mime_type: string;
  name: string;
  idempotency_key: string;
  asset_id?: string;
}
export class ImageAdapter {
  async pick(source: 'camera' | 'library'): Promise<LocalAttachment | null> {
    if (Platform.OS !== 'web') {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error('没有图片权限，仍可使用文字记录');
    }
    if (source === 'camera' && Platform.OS === 'web')
      throw new Error('网页预览请使用选图，拍照在 iPhone 上使用');
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.85,
      base64: true,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return null;
    const asset = result.assets[0];
    const context = ImageManipulator.manipulate(asset.uri);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.85,
      base64: Platform.OS === 'web',
    });
    const id = randomUUID();
    let uri = saved.uri;
    if (Platform.OS === 'web') {
      uri = 'data:image/jpeg;base64,' + saved.base64;
    } else {
      const dir = new Directory(Paths.document, 'fitmind-media');
      dir.create({ idempotent: true, intermediates: true });
      const dest = new File(dir, id + '.jpg');
      new File(uri).copy(dest);
      uri = dest.uri;
    }
    image.release();
    context.release();
    return {
      uri,
      kind: 'image',
      mime_type: 'image/jpeg',
      name: id + '.jpg',
      idempotency_key: id,
    };
  }
}
