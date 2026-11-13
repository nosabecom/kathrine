import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Text, useTheme, Surface } from 'react-native-paper';
export const isTV=Platform.isTV;
// Request focus after the newly mounted screen has laid out. Unlike a permanent
// preferred-focus flag, this does not pull focus back as the user navigates.
function usePreferredTVFocus(preferred:boolean,supplied?:RefObject<View>){
  const ownTarget=useRef<View>(null!),target=supplied||ownTarget;
  useEffect(()=>{
    if(!isTV||!preferred)return;
    const frame=requestAnimationFrame(()=>target.current?.requestTVFocus());
    return()=>cancelAnimationFrame(frame);
  },[preferred,target]);
  return target;
}
export function Action({preferred=false,...props}:ComponentProps<typeof Button>&{preferred?:boolean}){
  const [focused,setFocused]=useState(false),target=usePreferredTVFocus(preferred,props.touchableRef);const theme=useTheme();
  // Paper's ref points at its decorative Surface; focus its inner touchable.
  return <Button {...props} touchableRef={target} onFocus={event=>{setFocused(true);props.onFocus?.(event);}} onBlur={event=>{setFocused(false);props.onBlur?.(event);}} buttonColor={isTV&&focused?'#F5F7FA':props.buttonColor} textColor={isTV&&focused?'#101318':props.textColor} style={[{borderWidth:2,borderColor:focused?theme.colors.primary:'transparent',...(isTV?{borderRadius:8}:{} )},props.style]} contentStyle={[{minHeight:48},props.contentStyle]}/>;
}
export function FocusCard({children,onPress,label,style,preferred=false}:{children:ReactNode;onPress:()=>void;label:string;style?:ComponentProps<typeof View>['style'];preferred?:boolean}){const [focused,setFocused]=useState(false),target=usePreferredTVFocus(preferred);const theme=useTheme();return <Pressable ref={target} focusable accessibilityRole="button" accessibilityLabel={label} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} onPress={onPress} style={[{borderRadius:isTV?12:16,borderWidth:3,borderColor:focused?theme.colors.primary:'transparent',transform:[{scale:focused?1.025:1}],...(isTV?{padding:3}:{} )},style]}><Surface elevation={focused?4:1} style={{borderRadius:isTV?6:13,overflow:'hidden'}}>{children}</Surface></Pressable>;}
export function Empty({title,description,icon='movie-open-outline'}:{title:string;description:string;icon?:string}){const theme=useTheme();return <View style={styles.empty}><Icon source={icon} size={56} color={theme.colors.primary}/><Text variant="headlineSmall" style={{textAlign:'center'}}>{title}</Text><Text variant="bodyMedium" style={{textAlign:'center',color:theme.colors.onSurfaceVariant,maxWidth:440}}>{description}</Text></View>;}
const styles=StyleSheet.create({empty:{padding:40,gap:18,alignItems:'center',justifyContent:'center',minHeight:280}});
