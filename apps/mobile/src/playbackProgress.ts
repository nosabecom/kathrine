export class PlaybackProgress {
  private ready=false;
  constructor(public position:number) {}

  beginLoading() {
    this.ready=false;
    return this.position;
  }

  sourceLoaded() { this.ready=true; }

  update(currentTime:number,offset=0) {
    if(!this.ready||!Number.isFinite(currentTime)||currentTime<0)return false;
    this.position=currentTime+offset;
    return true;
  }

  checkpoint() { return this.ready?this.position:null; }
}
