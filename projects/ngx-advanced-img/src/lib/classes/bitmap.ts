import * as exif from 'exifr';
import mime from 'mime';
import { Observable, Subject } from 'rxjs';

import Timeout = NodeJS.Timeout;
import { NgxAdvancedImgJxon } from './jxon';

export type NgxAdvancedImgResolution = string | '';

/**
 * This interface defines the standard data signature that can represent an asset bitmap entry
 * in raw data format.
 */
export interface INgxAdvancedImgBitmapDataSignature {
  src: string;
  revision: number;
  resolution: NgxAdvancedImgResolution;
  loaded: boolean;
  size: number;
}

export class NgxAdvancedImgBitmap {

  public resolution: NgxAdvancedImgResolution;
  public src: string;
  public revision: number;
  public loaded: boolean;
  public image: HTMLImageElement | undefined;
  public size: number;
  private _ttl: number;	// time to live in seconds after it has been loaded
  private loadedAt: Date | null;
  private expirationClock: Timeout | null;
  private _destroyed: Subject<INgxAdvancedImgBitmapDataSignature> | undefined;
  private _objectURL: string;
  private _mimeType: string;
  private _orientation: number;
  private _fileSize: number;

  /**
   * The object URL format of the image that can be used for direct downloading to an end-user's machine.
   */
  public get objectURL(): string {
    return this._objectURL;
  }

  /**
   * The mime type for the loaded image.
   */
  public get mimeType(): string {
    return this._mimeType;
  }

  /**
   * The size of the file in bytes.
   */
  public get fileSize(): number {
    return this._fileSize;
  }

  /**
   * The time to live in seconds after the asset has been loaded, or if changing after it has already been loaded,
   * since the TTL was set. If 0 is given, this asset will live forever.
   */
  public get ttl(): number {
    return this._ttl;
  }

  /**
   * The time to live in seconds after the asset has been loaded, or if changing after it has already been loaded,
   * since the TTL was set. If 0 is given, this asset will live forever.
   */
  public set ttl(value: number) {
    // set the time to live in seconds
    this._ttl = (!isNaN(value) && isFinite(value) && +value >= 0) ? value : 0;

    // if we have an expiration clock ticking, clear it
    if (this.expirationClock) {
      clearTimeout(this.expirationClock);
      this.expirationClock = null;
    }

    // start the clock for when to destroy ourselves if we are not 0, infinitely
    if (this.ttl > 0) {
      this.expirationClock = setTimeout(this.onExpired.bind(this), this.ttl * 1000);
    }
  }

  /**
   * Returns the time, in seconds, for which this asset has lived since it was first loaded.
   */
  public get life(): number {
    if (!this.loadedAt || !this.src) {
      return 0;
    }

    // capture the current time
    const currentTime: Date = new Date();

    // return the time since the load time in seconds
    return currentTime.getSeconds() - this.loadedAt.getSeconds();
  }

  /**
   * An observable property that can be used to detect when this asset bitmap has been disposed of.
   */
  public get destroyed(): Observable<INgxAdvancedImgBitmapDataSignature> {
    if (!this._destroyed) {
      this._destroyed = new Subject<INgxAdvancedImgBitmapDataSignature>();
    }

    return this._destroyed.asObservable();
  }

  /**
   * Get the orientation of the image as defined by the exif data
   */
  public get orientation(): number {
    if (!this._orientation) {
      // normalize orientation if not defined
      this._orientation = 1;
    }

    return this._orientation;
  }

  /**
   * Return how many degrees an image should be rotated to normalize the
   * orientation based on the exif data.
   *
   * 1 = Horizontal (normal)
   * 2 = Mirror horizontal
   * 3 = Rotate 180
   * 4 = Mirror vertical
   * 5 = Mirror horizontal and rotate 270 CW
   * 6 = Rotate 90 CW
   * 7 = Mirror horizontal and rotate 90 CW
   * 8 = Rotate 270 CW
   */
  public get normalizedRotation(): number {
    if (navigator.userAgent?.indexOf('Firefox') > -1) {
      // firefox already deals with exif orientation, so don't normalize
      return 0;
    }

    switch (this.orientation) {
      case 3:
      case 4:
        return 180;

      case 5:
      case 6:
        return 270;

      case 7:
      case 8:
        return 90;

      default:
        return 0;
    }
  }

  public constructor(
    src: string,
    resolution: NgxAdvancedImgResolution,
    revision: number,
    ttl?: number,
  ) {
    this.src = (!!src) ? src : '';
    this.resolution = (resolution !== null && resolution !== undefined) ? resolution : '';
    this.revision = (!!revision) ? revision : 0;
    this.loaded = false;
    this.size = 0;
    this.expirationClock = this.loadedAt = null;

    this._ttl = !ttl ? 0 : (!isNaN(ttl) && isFinite(ttl) && +ttl >= 0) ? ttl : 0;
    this._destroyed = new Subject<INgxAdvancedImgBitmapDataSignature>();
    this._orientation = 1;
    this._mimeType = 'unknown';
    this._objectURL = '';
    this._fileSize = 0;
  }

  /**
   * Standard function for converting data URI strings into Blob objects.
   */
  public static dataURItoBlob(dataURI: string): Blob {
    // convert base64 to raw binary data held in a string
    // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
    const byteString = atob(dataURI.split(',')[1]);

    // separate out the mime component
    const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

    // write the bytes of the string to an ArrayBuffer
    const ab = new ArrayBuffer(byteString.length);

    // create a view into the buffer
    const ia = new Uint8Array(ab);

    // set the bytes of the buffer to the correct values
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }

    // write the ArrayBuffer to a blob, and you're done
    return new Blob([ab], { type: mimeString });
  }

  /**
   * Standard function for detecting mimeType based on buffer data.
   *
   * @param buffer The buffer data to detect the mimeType from.
   * @param blobDataType The blob data type to use as a fallback if the mimeType cannot be detected.
   */
  public static detectMimeType(buffer: Uint8Array, blobDataType: string): string {
    let header = '';

    // gather the hex data for the file header data
    for (const signature of buffer.subarray(0, 4)) {
      header += signature.toString(16);
    }

    // The identifying header for HEICS is offset by 4
    let middle = '';
    for (const signature of buffer.subarray(4, 12)) {
      middle += signature.toString(16);
    }

    if (middle === '6674797068656963') {
      header = middle;
    }

    // WEBP files require bytes 9-12 to differentiate
    // between other RIFFs like .wav or .avi
    if (header === '52494646') {
      for (const signature of buffer.subarray(8, 12)) {
        header += signature.toString(16);
      }
    }

    // convert the header to an appropriate mime type
    switch (header) {
      case '89504e47':
        return 'image/png';

      case '47494638':
        return 'image/gif';

      case '424d0000':
        return 'image/bmp';

      case '5249464657454250':
        return 'image/webp';

      case 'ffd8ffe0':
      case 'ffd8ffe1':
      case 'ffd8ffe2':
      case 'ffd8ffe3':
      case 'ffd8ffe8':
        return 'image/jpeg';

      case '6674797068656963':
        return 'image/heic';

      case '75ab5a6a':
      case '25504446':
      case '45e71e8a':
        return 'application/pdf';

      default:
        return blobDataType;
    }
  }

  /**
   * Destroys the current asset bitmap object and frees all memory in use.
   */
  public destroy(): void {
    // announce the disposal of this
    this._destroyed?.next({
      src: this.src,
      revision: this.revision,
      resolution: this.resolution,
      loaded: this.loaded,
      size: this.size,
    });

    this.ttl = 0;
    this.loaded = false;
    this.loadedAt = null;
    if (this.image) {
      this.image.onload = null;
      this.image.onerror = null;
    }
    this.image = undefined;
    this.size = 0;
    this._destroyed?.unsubscribe();
    this._destroyed = undefined;
  }

  /**
   * Attempts to load the image. When successful, it will mark the class as loaded and resolve the returned promise.
   *
   * @param anonymous Whether or not to load anonymously or not.
   * @param allowXMLLoading Drives whether XML serialization of image/svg+xml objects can be performed. By default, this feature is on, but some browsers do not support it.
   */
  public async load(anonymous = true, allowXMLLoading = true): Promise<NgxAdvancedImgBitmap> {
    // if no valid source, then reject the load
    if (!this.src) {
      return Promise.reject();
    }

    // if we have an expiration clock ticking, clear it
    if (this.expirationClock) {
      clearTimeout(this.expirationClock);
    }

    return new Promise((resolve, reject) => {
      let url: string;

      this.image = new Image();

      if (anonymous) {
        this.image.crossOrigin = 'anonymous';
      }

      // image loading error handler
      const onerror: () => void = () => {
        this.loaded = false;
        this.size = 0;

        // ensure that no expiration clock is running if we failed
        if (this.expirationClock) {
          clearTimeout(this.expirationClock);
        }

        reject(this);
      };

      // image load success handler
      this.image.onload = () => {
        if (!this.image) {
          // throw error if image has been destroyed
          return;
        }

        this.getImageBlob(this.image.src).then((blobData: Blob) => {
          // throw error if image has been destroyed
          if (!this.image) {
            reject(this);
          }

          // if we have an expiration clock ticking, clear it
          if (this.expirationClock) {
            clearTimeout(this.expirationClock);
          }

          // start the clock for when to destroy ourselves if we are not 0, infinitely
          if (this.ttl > 0) {
            this.expirationClock = setTimeout(this.onExpired.bind(this), this.ttl * 1000);
          }

          const fileReader: FileReader = new FileReader();

          // when the file reader successfully loads array buffers, process them
          fileReader.onload = async (event: Event) => {
            // if image has been destroyed error out
            if (!this.image) {
              onerror();
              return;
            }

            const buffer: Uint8Array = new Uint8Array((event.target as any).result);
            this._mimeType = NgxAdvancedImgBitmap.detectMimeType(buffer, blobData.type);

            const domURL: any = URL || webkitURL || window.URL;

            if (this.mimeType !== 'image/svg+xml' || !allowXMLLoading) {
              // if our browser doesn't support the URL implementation, fail the load
              if (!domURL || !(domURL).createObjectURL) {
                onerror();

                return;
              }

              // create a canvas to paint to
              let canvas: HTMLCanvasElement | null = document.createElement('canvas');

              // configure the dimensions of the canvas
              canvas.width = this.image.width;
              canvas.height = this.image.height;

              // acquire the rendering context
              const ctx: CanvasRenderingContext2D | null = canvas?.getContext('2d', { desynchronized: false, willReadFrequently: true });

              document.body.appendChild(canvas);

              // if the context cannot be acquired, we should quit the operation
              if (!ctx) {
                onerror();

                return;
              }

              ctx.drawImage(this.image, 0, 0);

              // if we haven't loaded anonymously, we'll taint the canvas and crash the application
              let dataUri: string = (anonymous) ? canvas.toDataURL(this._mimeType) : '';

              // if we got the bitmap data, create the link to download and invoke it
              if (dataUri) {
                // get the bitmap data in blob format
                this._objectURL = domURL.createObjectURL(NgxAdvancedImgBitmap.dataURItoBlob(dataUri));
              }

              // clean up the canvas
              if (canvas) {
                ctx?.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                canvas.width = canvas.height = 0;
                document.body.removeChild(canvas);
                canvas = null;
              }

              this.loaded = true;
              this.size = this.image.naturalWidth * this.image.naturalHeight;

              const head: string = `data:${this._mimeType};base64,`;
              this._fileSize = Math.round(atob(dataUri.substring(head.length)).length * (4 / 3));

              // track the time at which this asset was first asked to load
              this.loadedAt = new Date();

              // if we have an expiration clock ticking, clear it
              if (this.expirationClock) {
                clearTimeout(this.expirationClock);
              }

              await this.adjustForExifOrientation();

              // if we loaded a non-svg, then we are done loading
              resolve(this);
            } else {
              const client: XMLHttpRequest = new XMLHttpRequest();
              client.open('GET', this.image.src);
              client.onreadystatechange = () => {
                // if the document ready state is finished and ready
                if (client.readyState === 4) {
                  let svg: any = (new NgxAdvancedImgJxon()).stringToXml(client.responseText).getElementsByTagName('svg')[0];

                  // 'viewBox' is now a string, parse the string for the viewBox values - can be separated by whitespace and/or a comma
                  const viewBox: string[] = svg.getAttribute('viewBox').split(/[ ,]/);

                  // make sure the viewBox is set
                  if (viewBox.length !== 4) {
                    onerror();

                    return;
                  }

                  // get the width and height from the viewBox
                  const svgWidth: number = +viewBox[2];
                  const svgHeight: number = +viewBox[3];

                  // viewBox width and height is considered to be a required attribute, so check its existence and validity
                  if (
                    !svgWidth ||
                    !svgHeight ||
                    isNaN(svgWidth) ||
                    isNaN(svgHeight) ||
                    !isFinite(svgWidth) ||
                    !isFinite(svgHeight)
                  ) {
                    onerror();

                    return;
                  }

                  // set the width and height from the view box definition
                  svg.setAttribute('width', svgWidth);
                  svg.setAttribute('height', svgHeight);

                  // never preserve aspect ratio so the entire image fills the element boundaries
                  svg.setAttribute('preserveAspectRatio', 'none');

                  const svgXML: string = (new NgxAdvancedImgJxon()).xmlToString(svg);
                  svg = new Blob([svgXML], { type: this.mimeType + ';charset=utf-8' });

                  // if our browser doesn't support the URL implementation, fail the load
                  if (!this.image || !domURL || !(domURL).createObjectURL) {
                    onerror();

                    return;
                  }

                  this.image.onload = async () => {
                    this.loaded = true;
                    this.size = svgWidth * svgHeight;

                    // track the time at which this asset was first asked to load
                    this.loadedAt = new Date();

                    // if we have an expiration clock ticking, clear it
                    if (this.expirationClock) {
                      clearTimeout(this.expirationClock);
                    }

                    await this.adjustForExifOrientation();

                    // the image has successfully loaded
                    resolve(this);
                  };

                  this.image.loading = 'eager';
                  this.image.src = this._objectURL = domURL.createObjectURL(svg);
                }
              };

              // issue the file load
              client.send();
            }
          };

          // if we fail to load the file header data, throw an error to be captured by the promise catch
          fileReader.onerror = () => {
            throw new Error('Couldn\'t read file header for download');
          };

          // load the file data array buffer once we have the blob
          fileReader.readAsArrayBuffer(blobData);
        }).catch(onerror.bind(this));
      };

      // image load failure handler
      this.image.onerror = onerror;

      // calculate a unique revision signature to ensure we pull the image with the correct CORS headers
      let rev = '';
      if (this.revision >= 0) {
        if (this.src.indexOf('?') >= 0) {
          rev = '&rev=' + this.revision;
        } else {
          rev = '?rev=' + this.revision;
        }
      }

      // create a properly configured url despite protocol - make sure any resolution data is cleared
      if (this.resolution === '') {
        // distinct loads should take the direct source url
        url = this.src;
      } else {
        // clear resolution information if provided for situations where we intend to use some resolution
        url = this.src.replace(/_(.*)/g, '');
      }

      // append resolution and revision information for all scenarios if provided
      url += this.resolution + rev;

      // start loading the image
      this.image.loading = 'eager';
      this.image.src = url;
    });
  }

  /**
   * Invokes a save of this image to the user's disk assuming that it has already finished loading and the image
   * is in tact. It relies on the load procedures correctly setting the object url for the load that we can use
   * to invoke the download.
   *
   * @param fileName The name of the file to save.
   * @param objectURL The object URL to use for the download, if not provided, the original image url will be used.
   */
  public saveFile(fileName: string, objectURL?: string, mimeType?: string): void {
    if (!this.loaded || !this.image) {
      return;
    }

    if (!mimeType) {
      mimeType = this.mimeType;
    }

    const domURL: any = URL || webkitURL || window.URL;

    // if our browser doesn't support the URL implementation, then quit
    if (!domURL || !(domURL).createObjectURL) {
      return;
    }

    const extension: string | null = mime.getExtension(mimeType);
    let url: string = this.image.src;

    // use the object url if one is present
    if (objectURL) {
      url = objectURL;
    } else if (this.objectURL) {
      url = this.objectURL;
    }

    // create a link and set it into the DOM for programmatic use
    const link: HTMLAnchorElement = document.createElement('a');
    link.setAttribute('type', 'hidden');
    link.setAttribute('href', url);
    link.setAttribute('target', '_blank');
    link.download = (typeof extension === 'string' && !!extension) ? `${fileName}.${extension}` : fileName;
    document.body.appendChild(link);

    // invoke the link click to start the download
    link.click();

    // clean up the download operation
    domURL.revokeObjectURL(url);
    document.body.removeChild(link);
  }

  /**
   * If the image is loaded, this function will compress the image to the
   * desired quality and type and return a data url of bitmap information.
   *
   * @param quality The quality of the image compression.
   * @param type The type of file output we would like to generate.
   * @param resizeFactor The scaling factor to reduce the size of the image.
   * @param sizeLimit The maximum size of the image in bytes, if exceeded, the image will be compressed further.
   */
  public compress(quality: number, type: string, resizeFactor: number = 1, sizeLimit?: number): string {
    if (
      !this.image ||
      !this.loaded ||
      quality < 0 || quality > 1 ||
      (type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/webp')
    ) {
      throw new Error('Invalid compression params.');
    }

    console.warn('resize with', resizeFactor);

    // draw the image to the canvas
    let canvas: HTMLCanvasElement | null = document.createElement('canvas');
    canvas.width = this.image.width * resizeFactor;
    canvas.height = this.image.height * resizeFactor;

    const ctx: CanvasRenderingContext2D | null = canvas?.getContext('2d', { desynchronized: false, willReadFrequently: true });

    ctx?.drawImage(
      this.image,
      0,
      0,
      this.image.width * resizeFactor,
      this.image.height * resizeFactor,
    );

    // if we haven't loaded anonymously, we'll taint the canvas and crash the application
    let dataUri: string = canvas.toDataURL(type);

    const domURL: any = URL || webkitURL || window.URL;
    let objectURL = '';

    // if we got the bitmap data, create the link to download and invoke it
    if (dataUri) {
      // get the bitmap data
      objectURL = domURL.createObjectURL(NgxAdvancedImgBitmap.dataURItoBlob(dataUri));
    }

    // clean up the canvas
    if (canvas) {
      ctx?.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      canvas.width = canvas.height = 0;
      canvas = null;
    }

    if (!objectURL) {
      console.error('An error occurred while drawing to the canvas');
    }

    if (typeof sizeLimit === 'number' && !isNaN(sizeLimit) && isFinite(sizeLimit) && sizeLimit > 0) {
      const head: string = `data:${type};base64,`;
      const fileSize: number = Math.round(atob(dataUri.substring(head.length)).length * (4 / 3));

      if (fileSize > sizeLimit) {

        if (resizeFactor === undefined) {
          // if the resize factor wasn't supplied set to 1
          resizeFactor = 1;
        }

        if (resizeFactor <= 0) {
          throw new Error('Invalid resize factor reached (<= 0)');
        }

        return this.compress(quality, type, resizeFactor - 0.1, sizeLimit);
      }
    }


    return objectURL;
  }

  /**
   * Helper function that adjusts the image based on any exif data indicating
   * a different orientation be performed.
   */
  private async adjustForExifOrientation(): Promise<void> {
    if (!this.image) {
      return Promise.reject();
    }

    try {
      this._orientation = await exif.orientation(this.image) || 1;
    } catch (e) {
      // assume normal orientation if none can be found based on exif info
      this._orientation = 1;
    }

    if (this._orientation === undefined || this._orientation === null) {
      // assume normal orientation if none can be found based on exif info
      this._orientation = 1;
    }

    return Promise.resolve();
  }

  /**
   * Event handler for when expiration clocks are complete and we must dispose of ourselves.
   */
  private onExpired(): void {
    // only destroy if we had been loaded, otherwise let the loading pathways dispose of this bitmap
    if (this.loaded) {
      this.destroy();
    }

    // the expiration clock is now complete
    this.expirationClock = null;
  }

  /**
   * Fetch the blob info for a given url.
   *
   * @param url The url to the image to load the blob data.
   */
  private async getImageBlob(url: string): Promise<Blob> {
    if (!this.image) {
      return Promise.reject();
    }

    const headers: Headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');

    const response: Response = await fetch(url, {
      method: 'GET',
      mode: this.image.crossOrigin !== 'anonymous' ? 'no-cors' : undefined,
      headers,
    });

    return response.blob();
  }

}