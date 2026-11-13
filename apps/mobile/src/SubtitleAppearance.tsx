import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, TVFocusGuideView, View } from 'react-native';
import { Card, Divider, Icon, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Action, isTV } from './components';
import { defaultSubtitleAppearance, nativeSubtitleStyle, subtitlePresets, subtitlePreviewColor, subtitleSizes, type SubtitleAppearance as Appearance } from './subtitleAppearancePreferences';
import { useSubtitleAppearance } from './useSubtitleAppearance';

const sizeNames:Record<Appearance['size'],string>={small:'Small',medium:'Medium',large:'Large',extraLarge:'Extra large'};
const positionNames:Record<Appearance['position'],string>={bottom:'Bottom',raised:'Raised',middle:'Middle',top:'Top'};
const colorNames:Record<Appearance['color'],string>={white:'White',yellow:'Yellow',cyan:'Cyan',green:'Green',pink:'Pink'};
const backgroundNames:Record<Appearance['background'],string>={black:'Black',navy:'Midnight',white:'White'};
const edgeNames:Record<Appearance['edge'],string>={none:'None',dropShadow:'Soft shadow',outline:'Outline'};

function Choices<T extends string|number>({label,value,options,onChoose}:{label:string;value:T;options:{value:T;title:string}[];onChoose:(value:T)=>void}){
  return <View style={styles.choiceGroup}><Text style={styles.groupLabel}>{label}</Text><View style={styles.choices}>{options.map(option=><Action key={option.value} mode={value===option.value?'contained-tonal':'outlined'} icon={value===option.value?'check':undefined} accessibilityLabel={`${label}: ${option.title}`} accessibilityState={{selected:value===option.value}} onPress={()=>onChoose(option.value)}>{option.title}</Action>)}</View></View>;
}
function namedOptions<T extends string>(names:Record<T,string>){return (Object.keys(names) as T[]).map(value=>({value,title:names[value]}));}

export function SubtitlePreview({appearance,compact=false}:{appearance:Appearance;compact?:boolean}){
  const native=nativeSubtitleStyle(appearance),height=compact?150:isTV?190:180;
  const edge=appearance.edge==='none'?{}:{textShadowColor:'#000',textShadowOffset:{width:appearance.edge==='outline'?0:1,height:appearance.edge==='outline'?0:2},textShadowRadius:appearance.edge==='outline'?1:3};
  return <LinearGradient colors={['#183247','#0D1824','#06090F']} start={{x:0,y:0}} end={{x:1,y:1}} style={[styles.preview,{height}]} accessibilityLabel="Subtitle style preview">
    <View style={styles.previewHeader}><Text style={styles.previewLabel}>LIVE PREVIEW</Text><Icon source="closed-caption-outline" color="#AAB7C8" size={22}/></View>
    <View style={styles.horizon}/><View style={styles.previewSilhouette}/>
    <View style={[styles.captionPosition,appearance.position==='top'?{top:36}:appearance.position==='middle'?{top:'45%'}:{bottom:appearance.position==='raised'?height*.22:height*.08}]}>
      <Text style={[styles.caption,{fontSize:subtitleSizes[appearance.size]*(compact?0.65:0.75),lineHeight:subtitleSizes[appearance.size]*(compact?0.85:1),color:subtitlePreviewColor(native.foregroundColor),backgroundColor:subtitlePreviewColor(native.backgroundColor)},edge]}>One more episode?{compact?' ':'\n'}I was hoping you’d say that.</Text>
    </View>
  </LinearGradient>;
}

export function SubtitleAppearance({mode='card',onError}:{mode?:'card'|'button';onError?:(message:string)=>void}){
  const {appearance,loaded,saving,error,updateAppearance,resetAppearance}=useSubtitleAppearance();
  const [open,setOpen]=useState(false);
  const change=(patch:Partial<Appearance>)=>{void updateAppearance(patch).catch(e=>onError?.((e as Error).message));};
  const Container=isTV?TVFocusGuideView:View;
  const entry=<Action icon="format-text" mode={mode==='card'?'contained-tonal':'outlined'} disabled={!loaded} onPress={()=>setOpen(true)}>Customize subtitles</Action>;
  return <>
    {mode==='button'?entry:<Card mode="outlined"><Card.Title title="Subtitles, your way" subtitle="A cinematic look, made for your eyes" left={props=><Icon source="closed-caption-outline" size={props.size} color="#DCE8F8"/>}/><Card.Content style={styles.cardContent}><SubtitlePreview appearance={appearance} compact/>{entry}</Card.Content></Card>}
    <Modal visible={open} animationType="fade" onRequestClose={()=>setOpen(false)} presentationStyle="fullScreen">
      <Container style={styles.editor} {...(isTV?{autoFocus:true,trapFocusUp:true,trapFocusDown:true,trapFocusLeft:true,trapFocusRight:true}:{})}><SafeAreaView style={styles.safe} edges={isTV?[]:['top','bottom','left','right']}>
        <View style={styles.header}><View style={styles.heading}><Text style={styles.eyebrow}>MAKE IT YOURS</Text><Text style={styles.title}>Subtitle appearance</Text></View><Action icon="check" mode="contained-tonal" onPress={()=>setOpen(false)}>Done</Action></View>
        <ScrollView showsVerticalScrollIndicator contentContainerStyle={styles.content}>
          <SubtitlePreview appearance={appearance}/>
          <View style={styles.savedRow}><Icon source={error?'alert-circle-outline':saving?'content-save-outline':'check-circle-outline'} size={18} color={error?'#FFB4AB':'#A8B8CD'}/><Text style={[styles.help,error&&styles.error]}>{error||(saving?'Saving your style…':'Saved on this device. Changes apply while you watch.')}</Text></View>
          <View style={styles.choiceGroup}><Text style={styles.groupLabel}>Choose a look</Text><View style={styles.presets}>{subtitlePresets.map((preset,index)=>{
            const selected=Object.keys(defaultSubtitleAppearance).every(key=>appearance[key as keyof Appearance]===preset.appearance[key as keyof Appearance]);
            return <View key={preset.id} style={styles.preset}><Action preferred={index===0} mode={selected?'contained-tonal':'outlined'} icon={selected?'check':'closed-caption-outline'} accessibilityState={{selected}} onPress={()=>change(preset.appearance)}>{preset.title}</Action><Text style={styles.help}>{preset.description}</Text></View>;
          })}</View></View>
          <Divider style={styles.divider}/>
          <Choices label="Text size" value={appearance.size} options={namedOptions(sizeNames)} onChoose={size=>change({size})}/>
          <Choices label="Text color" value={appearance.color} options={namedOptions(colorNames)} onChoose={color=>change({color})}/>
          <Choices label="Text opacity" value={appearance.textOpacity} options={[{value:1,title:'Solid'},{value:.85,title:'85%'},{value:.65,title:'65%'}]} onChoose={textOpacity=>change({textOpacity})}/>
          <Choices label="Position" value={appearance.position} options={namedOptions(positionNames)} onChoose={position=>change({position})}/>
          <Divider style={styles.divider}/>
          <Choices label="Background color" value={appearance.background} options={namedOptions(backgroundNames)} onChoose={background=>change({background})}/>
          <Choices label="Background opacity" value={appearance.backgroundOpacity} options={[{value:0,title:'Clear'},{value:.25,title:'25%'},{value:.5,title:'Glass · 50%'},{value:.85,title:'85%'},{value:1,title:'Solid'}]} onChoose={backgroundOpacity=>change({backgroundOpacity})}/>
          <Choices label="Text edge" value={appearance.edge} options={namedOptions(edgeNames)} onChoose={edge=>change({edge})}/>
          <View style={styles.footer}><Text style={styles.help}>These choices style text subtitles. Subtitles stored as pictures or burned into the video keep their original appearance.</Text><Action icon="restore" onPress={()=>void resetAppearance().catch(e=>onError?.((e as Error).message))}>Reset to Cinema</Action></View>
        </ScrollView>
      </SafeAreaView></Container>
    </Modal>
  </>;
}
const styles=StyleSheet.create({
  cardContent:{gap:16},editor:{flex:1,backgroundColor:'#0B0E14'},safe:{flex:1,width:'100%',maxWidth:1120,alignSelf:'center'},header:{paddingHorizontal:isTV?32:20,paddingTop:isTV?24:16,paddingBottom:20,flexDirection:'row',alignItems:'center',gap:16,borderBottomWidth:1,borderBottomColor:'#FFFFFF12'},heading:{flex:1,gap:6},eyebrow:{fontSize:10,fontWeight:'700',letterSpacing:2,color:'#9AACBF'},title:{fontSize:isTV?28:24,fontWeight:'700',color:'#F4F6FA'},content:{padding:isTV?32:20,gap:24,paddingBottom:40},preview:{borderRadius:14,overflow:'hidden',borderWidth:1,borderColor:'#FFFFFF14'},previewHeader:{position:'absolute',top:12,left:16,right:16,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},previewLabel:{fontSize:9,letterSpacing:2,fontWeight:'700',color:'#AAB7C8'},horizon:{position:'absolute',top:'50%',left:0,right:0,height:1,backgroundColor:'#8BB2D520'},previewSilhouette:{position:'absolute',width:'28%',height:'60%',right:'16%',bottom:-24,borderTopLeftRadius:100,borderTopRightRadius:90,backgroundColor:'#050B12AA',transform:[{rotate:'-12deg'}]},captionPosition:{position:'absolute',left:12,right:12,alignItems:'center'},caption:{textAlign:'center',fontWeight:'500',paddingHorizontal:8,paddingVertical:3,borderRadius:3},savedRow:{flexDirection:'row',gap:9,alignItems:'center'},help:{fontSize:12,lineHeight:18,color:'#A8B8CD',flexShrink:1},error:{color:'#FFB4AB'},choiceGroup:{gap:12},groupLabel:{fontSize:15,fontWeight:'600',color:'#E8EDF6'},choices:{flexDirection:'row',flexWrap:'wrap',gap:10},presets:{flexDirection:isTV?'row':'column',gap:16},preset:{...(isTV?{flex:1}:{}),gap:8},divider:{backgroundColor:'#FFFFFF15'},footer:{gap:16,alignItems:'flex-start'},
});
