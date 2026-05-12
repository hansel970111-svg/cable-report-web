#!/usr/bin/env python3
"""PDF Editor Module."""
import sys
import re
import json
import fitz  # PyMuPDF
import os
from datetime import datetime

# 
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'fonts')
PROJECT_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts')
CALIBRI_REGULAR_FONT = os.path.join(PROJECT_FONT_DIR, 'LiberationSans-Regular.ttf')
CALIBRI_BOLD_FONT = os.path.join(PROJECT_FONT_DIR, 'LiberationSans-Bold.ttf')

# 
_font_cache = {}

# CID(PDFToUnicode)
# PDFCalibriToUnicode
# C2_2 
DATE_CHAR_TO_CID = {
    '0': '03EC',
    '1': '03ED',
    '2': '03EE',
    '3': '03EF',
    '4': '03F0',
    '5': '03F1',  # 03F1 -> '5' in F16 Calibri
    '6': '03F2',
    '7': '03F3',
    '8': '03F4',
    '9': '03F5',  # 03F5 -> '9' in F16 Calibri
    '-': '0372',
    '/': '0372',  # ()
    ' ': '0003'
}

# CID(PDFToUnicode)
# : " 01:43:17 PM"
TIME_CHAR_TO_CID = {
    ' ': '0003',
    '0': '03EC',
    '1': '03ED',
    '2': '03EE',
    '3': '03EF',
    '4': '03F0',
    '5': '03F1',
    '6': '03F2',
    '7': '03F3',
    '8': '03F4',
    '9': '03F5',
    ':': '0357',  # CID
    'P': '0057',  # PCID
    'M': '0044',  # MCID
    'A': '0004',  # ACID (AM)
}

# SiteCID( ToUnicode )
# C2_0  (Calibri-Bold)  CID 
#  PDF  ToUnicode bfrange 
# :  CID  PDF 
CALIBRI_CID_MAP = {
    # 
    ' ': '0003',
    # 
    '&': '0398',
    '(': '037E',
    ')': '037F',
    ':': '0357',
    # 
    'A': '0004',  # ACID
    'B': '0011',
    'C': '0012',
    'D': '0018',
    'E': '001C',
    'F': '0026',
    'L': '003E',
    'M': '0044',
    'P': '0057',
    'R': '005A',
    'S': '005E',
    'T': '0064',
    # 
    'a': '0102',
    'b': '010F',
    'c': '0110',
    'd': '011A',
    'e': '011E',
    'f': '0128',
    'g': '0150',
    'h': '015A',
    'i': '015D',
    'l': '016F',
    'm': '0175',
    'n': '0176',
    'o': '017D',
    'p': '0189',
    'r': '018C',
    's': '0190',
    't': '019A',
    'u': '01B5',
    'y': '01C7',
    # 
    '0': '03EC',
    '1': '03ED',
    '2': '03EE',
    '3': '03EF',
    '4': '03F0',
    '5': '03F1',
    '6': '03F2',
    '7': '03F3',
    '8': '03F4',
    '9': '03F5',
    # 
    '-': '0372',
    'M_c2_1': '0044',  # C2_1  M
}

# /C2_1 (Calibri-Bold) CID 
# : ,  M,  1, 3, 8
# 
CALIBRI_C2_1_CID_MAP = {
    ' ': '0003',  # 
    '-': '0372',  # 
    'M': '0044',  #  M
    '1': '03ED',  #  1
    '3': '03EF',  #  3
    '4': '03F0',  #  4
    '6': '03F2',  #  6
    '8': '03F4',  #  8
}

# C2_2 (Calibri) CID  - 
#  Tj[2] , :  's'
# :  CID  ToUnicode bfrange 
CALIBRI_C2_2_CID_MAP = {
    # 
    ' ': '0003',
    # 
    'A': '0004',
    'B': '0011',
    'D': '0018',
    'E': '001C',
    'G': '0027',
    'H': '002C',
    'M': '0044',
    'O': '004B',
    'P': '0057',
    'R': '005A',
    'S': '005E',
    'T': '0064',
    'U': '0068',
    #  (C2_2  's')
    'a': '0102',
    'd': '011A',
    'e': '011E',
    'g': '0150',
    'i': '015D',
    'n': '0176',
    'p': '0189',
    'r': '018C',
    't': '019A',
    'u': '01B5',
    # 
    '-': '0372',
    '/': '036C',
    '_': '037A',
    ':': '0357',
    # 
    '0': '03EC',
    '1': '03ED',
    '2': '03EE',
    '3': '03EF',
    '4': '03F0',
    '5': '03F1',
    '6': '03F2',
    '7': '03F3',
    '8': '03F4',
    '9': '03F5',
}

# C2_3 (Calibri) CID 
#  C2_2 
CALIBRI_C2_3_CID_MAP = {
    # 
    ' ': '0003',
    # 
    'A': '0004',
    'B': '0011',
    'E': '001C',
    'G': '0027',
    'M': '0044',
    'R': '005A',
    'S': '005E',
    # 
    'a': '0102',
    'b': '010F',
    'c': '0110',
    'd': '011A',
    'e': '011E',
    'f': '0128',
    'g': '0150',
    'h': '015A',
    'i': '015D',
    'j': '0164',
    'k': '0169',
    'l': '016F',
    'm': '0175',
    'n': '0176',
    'o': '017D',
    'p': '0189',
    'q': '018E',
    'r': '018C',
    's': '0190',
    't': '019A',
    'u': '01B5',
    'v': '01BA',
    'w': '01BF',
    'x': '01C4',
    'y': '01C7',
    'z': '01CA',
    # 
    '-': '0372',
    '#': '037B',
    '$': '037C',
    '+': '037D',
    '~': '037F',
    # 
    '0': '03EC',
    '1': '03ED',
    '2': '03EE',
    '3': '03EF',
    '4': '03F0',
    '5': '03F1',
    '6': '03F2',
    '7': '03F3',
    '8': '03F4',
    '9': '03F5',
}


def site_text_to_cid(text):
    """
    SiteCID
    
    . 
    , . 
    
    Args:
        text: ,  "Site:  DE46"  "-M138"
    
    Returns:
        str: CID(, )
    """
    result = []
    for char in text:
        # 
        if char in CALIBRI_CID_MAP:
            result.append(CALIBRI_CID_MAP[char].upper())
        else:
            # /
            upper_char = char.upper()
            lower_char = char.lower()
            if upper_char in CALIBRI_CID_MAP:
                result.append(CALIBRI_CID_MAP[upper_char].upper())
            elif lower_char in CALIBRI_CID_MAP:
                result.append(CALIBRI_CID_MAP[lower_char].upper())
            else:
                # file or JSON 
                # 
                print(f"[WARN] Site '{char}' has beenCID, ", file=sys.stderr)
                result.append('0003')
    
    return ''.join(result)


def site_text_to_cid_c2_2(text):
    """
    SiteC2_2CID
    
    C2_2(Calibri), . 
     Tj[2] ,  C2_1(Calibri-Bold). 
    
    Args:
        text: ,  "-DE46"
    
    Returns:
        str: CID(, )
    """
    result = []
    for char in text:
        # 
        if char in CALIBRI_C2_2_CID_MAP:
            result.append(CALIBRI_C2_2_CID_MAP[char].upper())
        else:
            # 
            upper_char = char.upper()
            if upper_char in CALIBRI_C2_2_CID_MAP:
                result.append(CALIBRI_C2_2_CID_MAP[upper_char].upper())
            else:
                # file or JSON 
                result.append('0003')
    
    return ''.join(result)


def replace_site_in_page_stream(page, site):
    """
    Site

    Site  Tj : 
    - Tj[1] (C2_0 ):  "Site:  " +  3 
    - Tj[2] (C2_1 ):  + tj2 

    , : 
    1. tj1 (C2_0):  "Site:  " + C2_0 ( 3 )
    2. tj_mid (C2_2):  tj1  C2_0 
    3. tj2 (C2_1):  tj2 , x_offset 

    : 
    - C2_0: B C D E F L M P R S T, a-z, 4, 6, &():
    - C2_1: M, 1, 3, 8, -
    - C2_2: A B D E G H M O P R S U, adeginprtu, 0-9, -/:_
    - C2_3: A B E G M R S, a-z, 0-9, #$+-~

    Returns:
        bool: 
    """
    import re

    # 
    contents = page.get_contents()
    if not contents:
        return False

    content_xref = contents[0]
    doc = page.parent

    # 
    stream = doc.xref_stream(content_xref)
    stream_text = stream.decode('latin-1', errors='replace')

    # ( tj1  CID )
    # MPO : tj1  11  CID
    # Cat5e : tj1  9  CID
    tj1_pattern = r'<005E015D019A011E0357[0-9A-Fa-f]+>Tj'
    tj1_matches = list(re.finditer(tj1_pattern, stream_text, re.IGNORECASE))
    
    is_cat5e = False
    if tj1_matches:
        match = tj1_matches[0]
        hex_str = match.group()[1:-3]
        cid_count = len(hex_str) // 4
        if cid_count == 9:
            is_cat5e = True
            print(f"[DEBUG]  Cat5e  (tj1 CID : {cid_count})")
        else:
            print(f"[DEBUG]  MPO  (tj1 CID : {cid_count})")
    
    # C2_0 ( CALIBRI_CID_MAP )
    # : C2_0 : 4, 6
    C2_0_SUPPORTED = set(' &():ABCDEFGHLMNPRSTabcdefghijklmnoprstuvwxyz46')
    # C2_1 
    C2_1_SUPPORTED = set('0123456789- M')
    # C2_2 
    C2_2_SUPPORTED = set('ABCDEGHMOPRSUabcdefghijklmnoprstuvwxyz0123456789-_/: ')
    # C2_3 
    C2_3_SUPPORTED = set('ABEGMRSVabcdefghijklmnopqrstuvwxyz0123456789 #$+-~')
    
    # Cat5e tj3 (C2_0 ) 
    CAT5E_TJ3_SUPPORTED_DIGITS = {'1', '8', '9'}

    original_site = site if site else "UNKNOWN"
    site_prefix = "Site: "  # Cat5e  1 ( 6 ,  tj1  9 CID,  +1 )
    # :  Cat5e,  tj1 = 'Site:  DE', site_prefix + tj1_chars = 'Site: ' + '  DE' = 'Site:  DE'
    
    # 
    if is_cat5e:
        Tj1_capacity = 9   # Cat5e: tj1  9 
        max_tj1_chars = Tj1_capacity - len(site_prefix)  # = 9 - 6 = 3 
        Tj2_capacity = 2   # Cat5e: tj2  2 
        TJ_MID_CAPACITY = 3  # Cat5e: tj_mid  3 
        Tj3_capacity = 3   # Cat5e: tj3  3  ( + 2)
        Tj4_capacity = 2   # Cat5e: tj4  2 
    else:
        Tj1_capacity = 11  # MPO: tj1  11 
        max_tj1_chars = Tj1_capacity - len(site_prefix)  # = 11 - 6 = 5 
        Tj2_capacity = 5   # MPO: tj2  5 
        TJ_MID_CAPACITY = 4  # MPO: tj_mid  4 
        Tj3_capacity = 0
        Tj4_capacity = 0

    #  site ()
    #  PDF  Site  "DE46-M138": 
    # part1 =  = "DE46"
    # part2 =  = "M138"
    if '-' in original_site:
        parts = original_site.rsplit('-', 1)
        part1 = parts[0]  # 
        part2 = parts[1] if len(parts) > 1 else ""
    else:
        part1 = original_site
        part2 = ""

    # 
    has_dash = '-' in original_site

    # 
    c2_0_chars = []   # C2_0 
    c2_1_chars = []   # C2_1 
    c2_2_chars = []   # C2_2 
    c2_3_chars = []   # C2_3 
    other_chars = []  # 

    #  part2()- 
    for c in part2:
        if c in C2_0_SUPPORTED:
            c2_0_chars.append(c)
        elif c in C2_1_SUPPORTED:
            c2_1_chars.append(c)
        elif c in C2_2_SUPPORTED:
            c2_2_chars.append(c)
        elif c in C2_3_SUPPORTED:
            c2_3_chars.append(c)
        else:
            other_chars.append(c)

    #  part1 
    for c in part1:
        if c in C2_0_SUPPORTED:
            c2_0_chars.append(c)
        elif c in C2_1_SUPPORTED:
            c2_1_chars.append(c)
        elif c in C2_2_SUPPORTED:
            c2_2_chars.append(c)
        elif c in C2_3_SUPPORTED:
            c2_3_chars.append(c)
        else:
            other_chars.append(c)

    # tj1 
    tj1_capacity = max_tj1_chars  # Cat5e: 2, MPO: 4  6
    tj1_chars = []
    tj_mid_chars = []     #  tj_mid 
    tj2_text_parts = []  # tj2 

    # 
    if has_dash:
        # : 
        # Cat5e: tj1 = part2 2C2_0, tj2 = part2, tj3 = -part12, tj4 = part12
        # MPO: tj1 = part2  C2_0 ()+ part1  C2_0 ()
        
        if is_cat5e:
            # Cat5e 
            #  PDF , Site = "DE46-M138" : 
            #   tj1: 2 ( "DE")
            #   tj2:  ( "46")
            #   tj3: "-" +  + "1" ( "-M1")
            #   tj4:  ( "38")
            #
            # :  part1 =  ( "DE46"), part2 =  ( "M138")
            # tj1  part2  C2_0 ( PDF  "DE")
            part1_c20 = [c for c in part1 if c in C2_0_SUPPORTED]
            part1_digits = [c for c in part1 if c.isdigit()]
            part2_c20 = [c for c in part2 if c in C2_0_SUPPORTED]
            part2_digits = [c for c in part2 if c.isdigit()]
            
            # tj1: part1  C2_0 ()+ '1'()
            # tj1  2 
            tj1_chars = part1_c20[:1]  # ()
            if '1' in part1_digits:
                tj1_chars.append('1')  #  '1'
            elif len(part1_c20) > 1:
                tj1_chars.append(part1_c20[1])  # 
            else:
                # part1  C2_0 ,  part2 
                part2_c20_remaining = [c for c in part2_c20 if c not in part1_c20]
                if part2_c20_remaining:
                    tj1_chars.append(part2_c20_remaining[0])
                elif '1' in part2_digits:
                    tj1_chars.append('1')
                else:
                    tj1_chars.append(' ')  # , 
            while len(tj1_chars) < 2:
                tj1_chars.append(' ')
            tj1_set = set(tj1_chars)
            
            # tj2:  part1 ( PDF  "46")
            # : '1'  C2_1 ,  '3' 
            C2_1_BAD_DIGITS = {'1'}  #  '1' 
            good_part1_digits = [c for c in part1_digits if c not in C2_1_BAD_DIGITS]
            good_part2_digits = [c for c in part2_digits if c not in C2_1_BAD_DIGITS]
            # tj2  part1 
            tj2_text_parts = good_part1_digits[:2]
            while len(tj2_text_parts) < 2:
                tj2_text_parts.append(' ')
            
            # tj3:  +  part  C2_0  + '1'()
            # tj3  3 : '-' +  part  C2_0 
            tj3_chars = ['-']
            #  part  part(tj1  part)
            # tj1  part2 ,  part  part2
            letter_part = part2
            letter_part_digits = part2_digits
            #  part  C2_0 ( tj1 has been)
            letter_part_c20 = [c for c in letter_part if c in C2_0_SUPPORTED and c not in tj1_set]
            for c in letter_part_c20:
                if len(tj3_chars) >= 3:
                    break
                tj3_chars.append(c)
            #  part  '1'  tj3(C2_0  '1')
            #  '1'  tj1 
            if '1' in letter_part_digits and '1' not in tj1_set and len(tj3_chars) < 3:
                tj3_chars.append('1')
            while len(tj3_chars) < 3:
                tj3_chars.append(' ')
            
            # tj4:  part2 ( PDF  tj4  "38",  2 )
            # tj4  part2_digits ( tj1  '1')
            # tj4  C2_1 , '3' , 
            tj4_chars = [c for c in part2_digits if c != '1'][:2]
            while len(tj4_chars) < 2:
                tj4_chars.append(' ')
            
            # tj_mid (Cat5e  tj_mid)
            tj_mid_chars = []
        else:
            # MPO 
            # tj1:  C2_0 , ()
            # tj_mid:  C2_2 ,  part2 
            # tj2:  C2_1 , 
            # tj1, tj_mid, tj2 ,  Site 
            
            if not part2:
                # 
                # tj1: 
                # tj_mid: 
                # tj2: 
                tj1_chars = []
                tj_mid_chars = []
                for c in site:
                    if c in C2_0_SUPPORTED and len(tj1_chars) < max_tj1_chars:
                        tj1_chars.append(c)
                while len(tj1_chars) < max_tj1_chars:
                    tj1_chars.append(' ')
                tj1_set = set(tj1_chars)
                # tj_mid 
                while len(tj_mid_chars) < TJ_MID_CAPACITY:
                    tj_mid_chars.append(' ')
                # tj2: 
                tj2_text_parts = []
                for c in site:
                    if len(tj2_text_parts) >= Tj2_capacity:
                        break
                    if c.isdigit():
                        tj2_text_parts.append(c)
                while len(tj2_text_parts) < Tj2_capacity:
                    tj2_text_parts.append(' ')
            else:
                #  part1  'M' ( Site ), 
                #  tj1 
                if part1.startswith('M') and not part2.startswith('M'):
                    site = f"{part2}-{part1}"
                    parts = site.split('-')
                    part1, part2 = parts[0], parts[1]
                
                # 
                # tj1:  part1  + C2_0 (4, 6)
                # tj_mid:  + part2 
                # tj2: part1  part2  C2_1 (1, 3, 8)
                
                # C2_0 
                C2_0_DIGITS = {'4', '6'}
                
                # tj1: part1  C2_0 
                tj1_chars = []
                for c in part1:
                    if len(tj1_chars) >= max_tj1_chars:
                        break
                    if c in C2_0_SUPPORTED or c in C2_0_DIGITS:
                        tj1_chars.append(c)
                while len(tj1_chars) < max_tj1_chars:
                    tj1_chars.append(' ')
                tj1_set = set(tj1_chars)
                
                # tj_mid:  + part2  + C2_0 (4, 6)
                # C2_0 : 4, 6
                C2_0_DIGITS = {'4', '6'}
                tj_mid_chars = ['-']
                #  part2 
                for c in part2:
                    if len(tj_mid_chars) >= TJ_MID_CAPACITY:
                        break
                    if c in C2_0_SUPPORTED and c not in C2_0_DIGITS:
                        tj_mid_chars.append(c)
                #  part2  4, 6
                for c in part2:
                    if len(tj_mid_chars) >= TJ_MID_CAPACITY:
                        break
                    if c in C2_0_DIGITS:
                        tj_mid_chars.append(c)
                while len(tj_mid_chars) < TJ_MID_CAPACITY:
                    tj_mid_chars.append(' ')
                
                # tj2:  + part2 
                # tj2 :  + part2 (,  C2_1 )
                # tj2 : 5 
                # tj2  /C2_1 ,  1, 3, 8 , 
                tj2_text_parts = ['-']
                #  part2 ()
                for c in part2:
                    if len(tj2_text_parts) >= Tj2_capacity:
                        break
                    if c.isalpha():
                        tj2_text_parts.append(c)
                #  part2  C2_1 (1, 3, 8)
                C2_1_GOOD_DIGITS = {'1', '3', '8'}
                for c in part2:
                    if len(tj2_text_parts) >= Tj2_capacity:
                        break
                    if c in C2_1_GOOD_DIGITS:
                        tj2_text_parts.append(c)
                # 
                while len(tj2_text_parts) < Tj2_capacity:
                    tj2_text_parts.append(' ')
                
                # tj_mid: (tj2 has been)
                tj_mid_chars = []
                while len(tj_mid_chars) < TJ_MID_CAPACITY:
                    tj_mid_chars.append(' ')
    else:
        # : 
        # part1 = original_site( Site ), part2 
        
        # Cat5e (: C2_0 ): 
        # tj1 (C2_0):  ONLY
        # tj2 (C2_1):  ( 1, 3, 4, 6, 8)
        # tj3 (C2_0):  ONLY
        # tj4 (C2_1): 
        
        if is_cat5e:
            # C2_0  C2_1  C2_2
            tj1_chars = []
            tj2_text_parts = []  # C2_1
            tj3_chars = []  # C2_0 -  ONLY
            tj4_chars = []  # C2_1
            
            # 
            letters = [c for c in part1 if c.isalpha()]
            digits = [c for c in part1 if c.isdigit()]
            
            # tj1: 
            for c in letters:
                if len(tj1_chars) < max_tj1_chars:
                    tj1_chars.append(c)
            while len(tj1_chars) < max_tj1_chars:
                tj1_chars.append(' ')
            
            # tj2: 
            for c in digits:
                if len(tj2_text_parts) < Tj2_capacity:
                    tj2_text_parts.append(c)
            while len(tj2_text_parts) < Tj2_capacity:
                tj2_text_parts.append(' ')
            
            # tj3: ()
            remaining_letters = [c for c in letters if c not in tj1_chars]
            for c in remaining_letters:
                if len(tj3_chars) < Tj3_capacity:
                    tj3_chars.append(c)
            while len(tj3_chars) < Tj3_capacity:
                tj3_chars.append(' ')
            
            # tj4: ()
            # has been( set ,  '6666')
            tj2_count = sum(1 for c in tj2_text_parts if c != ' ')
            remaining_digits = digits[tj2_count:]  # 
            for c in remaining_digits:
                if len(tj4_chars) < Tj4_capacity:
                    tj4_chars.append(c)
            while len(tj4_chars) < Tj4_capacity:
                tj4_chars.append(' ')
            
        # : tj1_chars has been, 
    # tj1_hex 

    # tj_mid_all :  tj_mid_chars 
    tj_mid_text = ''
    if tj_mid_chars:
        tj_mid_all = tj_mid_chars[:]
        while len(tj_mid_all) < TJ_MID_CAPACITY:
            tj_mid_all.append(' ')
        tj_mid_all = tj_mid_all[:TJ_MID_CAPACITY]
        tj_mid_text = ''.join(tj_mid_all)
    else:
        tj_mid_all = []
    
    # tj1_text : site_prefix + tj1_chars
    # site_prefix = 'Site:  ' has been
    # tj1_chars has been()
    tj1_text = site_prefix + ''.join(tj1_chars)

    #  Tj[2] 
    # tj2_text 
    # tj2_text  C2_1 ,  tj2('-M138')
    # ,  '-' 
    tj2_text = ''.join(tj2_text_parts) if tj2_text_parts else None
    # tj_mid_text 
    tj_mid_text = ''.join(tj_mid_all)

    #  CID
    def get_cid(char, char_map):
        """ CID"""
        upper = char.upper()
        lower = char.lower()
        if char in char_map:
            return char_map[char].upper()
        elif upper in char_map:
            return char_map[upper].upper()
        elif lower in char_map:
            return char_map[lower].upper()
        else:
            return '0003'  # 

    def get_tj1_cid(char, is_cat5e_template):
        """ tj1  CID, tj1  C2_0 
        C2_0  D, E , 
        """
        # Cat5e: tj1 ,  Tj 
        # ( 'i'  map )
        if char in CALIBRI_CID_MAP:
            return CALIBRI_CID_MAP[char].upper()
        upper = char.upper()
        if upper in CALIBRI_CID_MAP:
            return CALIBRI_CID_MAP[upper].upper()
        #  is_cat5e, 
        if is_cat5e_template and not char.isalpha():
            return '0003'  # 
        return '0003'  # 

    # tj1  CALIBRI_CID_MAP (C2_0)
    tj1_cid = ''.join(get_tj1_cid(c, is_cat5e) for c in tj1_text)

    # tj2  CALIBRI_C2_1_CID_MAP (C2_1  -, M, 1, 3, 8)
    # :  4, 6
    tj2_cid = ''.join(get_cid(c, CALIBRI_C2_1_CID_MAP) for c in tj2_text) if tj2_text else None

    # tj_mid  CALIBRI_C2_2_CID_MAP (C2_2)
    # tj_mid_cid  tj_mid_all()
    tj_mid_cid = ''.join(get_cid(c, CALIBRI_C2_2_CID_MAP) for c in tj_mid_all)

    #  Site:  Tj 
    site_pattern = r'<005E015D019A011E0357[0-9A-Fa-f]+>Tj'
    matches = list(re.finditer(site_pattern, stream_text, re.IGNORECASE))

    #  Site ( Tj , )
    # : <00180102019A011E...>Tj (11 CIDs for "DE46-M138")
    site_other_pattern = r'<00180102019A011E[0-9A-Fa-f]+>Tj'
    other_matches = list(re.finditer(site_other_pattern, stream_text, re.IGNORECASE))

    #  tj1_matches,  other_matches
    if len(matches) > 0:
        match = matches[0]
        original_tj = match.group()
        original_hex = original_tj[1:-3]  #  <  >Tj
        tj1_start = match.start()
        tj1_end = match.start() + len(original_tj)
        is_data_page_site = False
    elif len(other_matches) > 0:
        #  Site :  Tj 
        match = other_matches[0]
        original_tj = match.group()
        original_hex = original_tj[1:-3]
        tj1_start = match.start()
        tj1_end = match.start() + len(original_tj)
        is_data_page_site = True
        print(f"[DEBUG]  Site : {original_tj}")
    else:
        return False

    if is_cat5e:
        # === Cat5e  ===
        # Cat5e  4  Tj (): 
        # tj1: "Site:  XX" (9 CIDs) - C2_0
        # tj2: "XX" (2 CIDs) - C2_1
        # tj3: "-XX" (3 CIDs) - C2_0
        # tj4: "XX" (2 CIDs) - C2_1
        # 
        #  Site  Tj ( "DE46-M138"), 
        
        #  Site :  Tj 
        if is_data_page_site:
            #  Site 
            #  Site  C2_0 ,  site  C2_0 CID
            #  site  "-" 
            parts = site.split('-')
            part1 = parts[0]  #  "M138"
            part2 = parts[1] if len(parts) > 1 else ""  #  "DE46"
            
            #  Site :  part1 + "-" + part2
            # : "DE46-M138" -> "DE46-M138"
            data_page_site = site  # 
            
            #  data_page_site  C2_0 CID 
            data_page_cid = ''
            for c in data_page_site:
                cid = get_cid(c, CALIBRI_CID_MAP)
                if cid:
                    data_page_cid += cid.upper()
                else:
                    data_page_cid += '0003'  # 
            
            #  Tj ()
            original_cid_count = len(original_hex) // 4
            cid_list = [data_page_cid[i:i+4] for i in range(0, len(data_page_cid), 4)]
            while len(cid_list) < original_cid_count:
                cid_list.append('0003')  # 
            data_page_cid_padded = ''.join(cid_list[:original_cid_count])
            
            new_tj = f"<{data_page_cid_padded}>Tj"
            print(f"[DEBUG]  Site : {original_tj} -> {new_tj}")
            stream_text = stream_text[:tj1_start] + new_tj + stream_text[tj1_end:]
            
            #  Site 
            #  Site 
            other_pattern = r'<00180102019A011E[0-9A-Fa-f]+>Tj'
            offset = 0
            while True:
                other_match = re.search(other_pattern, stream_text[offset:], re.IGNORECASE)
                if not other_match:
                    break
                other_start = offset + other_match.start()
                other_end = offset + other_match.end()
                other_original = stream_text[other_start:other_end]
                
                # has been(tj1_start  tj1_end )
                if other_start >= tj1_start and other_end <= tj1_end:
                    offset = other_end
                    continue
                
                #  Site 
                other_hex = other_original[1:-3]
                other_cid_count = len(other_hex) // 4
                cid_list = [data_page_cid[i:i+4] for i in range(0, len(data_page_cid), 4)]
                while len(cid_list) < other_cid_count:
                    cid_list.append('0003')
                other_cid_padded = ''.join(cid_list[:other_cid_count])
                other_new_tj = f"<{other_cid_padded}>Tj"
                
                print(f"[DEBUG]  Site : {other_original} -> {other_new_tj}")
                stream_text = stream_text[:other_start] + other_new_tj + stream_text[other_end:]
                offset = other_start + len(other_new_tj)
            
            # 
            new_stream = stream_text.encode('latin-1')
            doc.update_stream(content_xref, new_stream)
            return True
        
        #  tj1_hex 
        new_tj1_hex = tj1_cid.upper()
        if len(new_tj1_hex) < len(original_hex):
            new_tj1_hex = new_tj1_hex + '0003' * ((len(original_hex) - len(new_tj1_hex)) // 4)
        elif len(new_tj1_hex) > len(original_hex):
            new_tj1_hex = new_tj1_hex[:len(original_hex)]
        
        new_tj1 = f"<{new_tj1_hex}>Tj"
        
        #  tj1
        stream_text = stream_text[:tj1_start] + new_tj1 + stream_text[tj1_end:]
        #  tj1_end 
        new_tj1_end = tj1_start + len(new_tj1)
        
        # Cat5e ( PDF ): 
        #  site = "DE46-M138":
        #   tj1: site_prefix + "DE" (2C2_0) -> "Site:  DE"
        #   tj2: "46" (2C2_1)
        #   tj3: "-M1" ( + 2C2_0)
        #   tj4: "38" (2C2_1)
        #
        # :
        #   tj2:  part2 (2)
        #   tj3: () + part1 
        #   tj4: part1 (2)
        
        parts = site.split('-')
        part1 = parts[0]  #  "M138"
        part2 = parts[1] if len(parts) > 1 else ""  #  "DE46"
        
        #  has_dash has been tj2_chars  tj4_chars
        # tj2_chars  tj4_chars has been has_dash 
        # tj2_text_parts  tj2_chars
        
        #  CID
        # tj2  C2_2 ()
        tj2_hex = ''.join(get_cid(c, CALIBRI_C2_2_CID_MAP) for c in tj2_text_parts)
        print(f"[DEBUG] tj1_chars: {tj1_chars}")
        print(f"[DEBUG] tj2_text_parts: {tj2_text_parts}")
        print(f"[DEBUG] tj2_hex: {tj2_hex}")
        # tj3 :  C2_0,  C2_2
        def get_tj3_cid(char):
            if char == '-':
                return '0372'  #  C2_0 
            elif char in C2_0_SUPPORTED:
                return get_cid(char, CALIBRI_CID_MAP)
            else:
                return get_cid(char, CALIBRI_C2_2_CID_MAP)
        tj3_hex = ''.join(get_tj3_cid(c) for c in tj3_chars)
        # tj4  C2_2 ()
        # tj4_hex  tj4_chars 
        tj4_hex = ''.join(get_cid(c, CALIBRI_C2_2_CID_MAP) for c in tj4_chars) if tj4_chars else ''
        print(f"[DEBUG] tj3_chars: {tj3_chars}")
        print(f"[DEBUG] tj4_chars: {tj4_chars}")
        print(f"[DEBUG] tj4_hex: {tj4_hex}")
        print(f"[DEBUG] tj3_hex: {tj3_hex}")
        
        # :  tj1  tj2, tj3, tj4
        # tj1 :  -> tj2 ->  -> tj3 ->  -> tj4
        search_text = stream_text[new_tj1_end:]
        
        #  tj1  Tj ( <XXXX> Tj ,  [XXXX] TJ )
        all_tj_pattern = r'<([0-9A-Fa-f]+)>Tj'
        tj_blocks = list(re.finditer(all_tj_pattern, search_text, re.IGNORECASE))
        
        # 
        cumulative_offset = new_tj1_end
        
        # tj2  Tj ( 0)
        if len(tj_blocks) >= 1:
            tj2_block = tj_blocks[0]
            #  tj2 , 
            original_tj2_hex = tj_blocks[0].group(1)
            original_tj2_len = len(original_tj2_hex)
            #  tj2_hex ( CID 0003 )
            if len(tj2_hex) < original_tj2_len:
                space_count = (original_tj2_len - len(tj2_hex)) // 4
                tj2_hex_new = tj2_hex + "0003" * space_count
            else:
                tj2_hex_new = tj2_hex[:original_tj2_len]
            # ( stream_text )
            tj2_start = cumulative_offset + tj2_block.start()
            tj2_end = cumulative_offset + tj2_block.end()
            stream_text = stream_text[:tj2_start] + f"<{tj2_hex_new}>Tj" + stream_text[tj2_end:]
            # 
            cumulative_offset = tj2_start + len(f"<{tj2_hex_new}>Tj")
        
        #  tj ,  stream_text has been
        search_text = stream_text[cumulative_offset:]
        tj_blocks = list(re.finditer(all_tj_pattern, search_text, re.IGNORECASE))
        
        # tj3  Tj ( 0)
        if len(tj_blocks) >= 1:
            tj3_block = tj_blocks[0]
            #  tj3 
            original_tj3_hex = tj3_block.group(1)
            original_tj3_len = len(original_tj3_hex)
            
            # tj3 , 
            if len(tj3_hex) < original_tj3_len:
                space_count = (original_tj3_len - len(tj3_hex)) // 4
                tj3_hex_new = tj3_hex + "0003" * space_count
            else:
                tj3_hex_new = tj3_hex[:original_tj3_len]
            # 
            tj3_start = cumulative_offset + tj3_block.start()
            tj3_end = cumulative_offset + tj3_block.end()
            stream_text = stream_text[:tj3_start] + f"<{tj3_hex_new}>Tj" + stream_text[tj3_end:]
            # 
            cumulative_offset = tj3_start + len(f"<{tj3_hex_new}>Tj")
        
        #  tj 
        search_text = stream_text[cumulative_offset:]
        tj_blocks = list(re.finditer(all_tj_pattern, search_text, re.IGNORECASE))
        
        # tj4  Tj ( 0)
        if len(tj_blocks) >= 1:
            tj4_block = tj_blocks[0]
            #  tj4 
            original_tj4_hex = tj4_block.group(1)
            original_tj4_len = len(original_tj4_hex)
            #  tj4_hex 
            if len(tj4_hex) < original_tj4_len:
                    space_count = (original_tj4_len - len(tj4_hex)) // 4
                    tj4_hex_new = tj4_hex + "0003" * space_count
            else:
                tj4_hex_new = tj4_hex[:original_tj4_len]
            print(f"[DEBUG] original_tj4_hex: {original_tj4_hex}, len: {original_tj4_len}")
            print(f"[DEBUG] tj4_hex_new: {tj4_hex_new}")
            # 
            tj4_start = cumulative_offset + tj4_block.start()
            tj4_end = cumulative_offset + tj4_block.end()
            stream_text = stream_text[:tj4_start] + f"<{tj4_hex_new}>Tj" + stream_text[tj4_end:]
        
        # 
        new_stream = stream_text.encode('latin-1')
        doc.update_stream(content_xref, new_stream)
        
        return True
    else:
        # === MPO () ===

        #  tj1_hex 
        new_tj1_hex = tj1_cid.upper()
        if len(new_tj1_hex) < len(original_hex):
            new_tj1_hex = new_tj1_hex + '0003' * ((len(original_hex) - len(new_tj1_hex)) // 4)
        elif len(new_tj1_hex) > len(original_hex):
            new_tj1_hex = new_tj1_hex[:len(original_hex)]
        
        new_tj1 = f"<{new_tj1_hex}>Tj"
        #  tj1_hex ()
        tj1_hex_chars = len(new_tj1_hex) // 4
        # : 
        import sys
        # 
        tj1_start = match.start()
        tj1_end = match.start() + len(original_tj)
        
        #  tj1
        stream_text = stream_text[:tj1_start] + new_tj1 + stream_text[tj1_end:]
        
        #  tj1  tj_mid( tj_mid )
        # tj_mid  x_offset  tj1  (20)
        # tj1 , tj_mid  tj1 
        new_tj1_end = tj1_start + len(new_tj1)
        # tj1  = 20 + new_tj1_width
        # tj_mid  x_offset = new_tj1_width( tj1 )
        TJ1_CHAR_WIDTH = 3.22  # tj1  C2_0 
        new_tj1_width = tj1_hex_chars * TJ1_CHAR_WIDTH
        #  tj_mid 
        has_tj_mid = any(c != ' ' for c in tj_mid_all)
        if has_tj_mid:
            tj_mid_td_offset = f"{new_tj1_width:.3f} 0 Td"
            tj_mid_tj = f"\n/C2_2 8 Tf\n{tj_mid_td_offset}\n<{tj_mid_cid}>Tj"
            stream_text = stream_text[:new_tj1_end] + tj_mid_tj + stream_text[new_tj1_end:]

        #  tj2 
        # :  tj2  x_offset  tj1 
        # tj2  x_offset  tj1 
        #  x_offset = 35.426
        #  x_offset =  x_offset - ( tj1  -  tj1 )
        TJ_CHAR_WIDTH = 4.32  # tj_mid  C2_2 
        TJ1_CHAR_WIDTH = 3.22  # tj1  C2_0 
        ORIGINAL_TJ2_X_OFFSET = 35.426  #  tj2  x_offset
        ORIGINAL_TJ1_WIDTH = 11 * TJ1_CHAR_WIDTH  #  tj1 (11 )
    
    #  tj1 ()
    new_tj1_width = tj1_hex_chars * TJ1_CHAR_WIDTH
    #  tj_mid ()
    # : tj_mid ,  tj2  offset  tj_mid 
    tj_mid_chars_count = len(tj_mid_all)
    # tj_mid  C2_2 , 
    # tj2  offset  tj1  tj_mid 
    #  tj_mid () tj_mid 
    TJ_MID_CHAR_WIDTH = 4.32  # tj_mid  C2_2 
    if has_tj_mid:
        # tj_mid , offset  tj_mid 
        # tj2  x_offset  tj1 
        #  x_offset =  x_offset - ( tj1  -  tj1 ) - tj_mid 
        new_x_offset = ORIGINAL_TJ2_X_OFFSET - (new_tj1_width - ORIGINAL_TJ1_WIDTH) - (tj_mid_chars_count * TJ_MID_CHAR_WIDTH)
    else:
        # tj_mid , tj2  tj1 
        #  x_offset =  x_offset - ( tj1  -  tj1 )
        new_x_offset = ORIGINAL_TJ2_X_OFFSET - (new_tj1_width - ORIGINAL_TJ1_WIDTH)
    
    #  tj2  Tj 
    # tj2  C2_1 ,  1, 3, 8,  M
    if tj2_text_parts and any(c.strip() for c in tj2_text_parts):
        # tj2 ,  C2_1 
        #  C2_1 : 1, 3, 8, , M, 
        tj2_cid = ''.join(get_cid(c, CALIBRI_C2_1_CID_MAP) for c in tj2_text_parts)
    else:
        # tj2 
        tj2_cid = None
    
    #  new_tj2
    if tj2_cid:
        new_tj2 = f"<{tj2_cid}>Tj"
    else:
        # tj2_cid = None ,  tj2  CID
        new_tj2 = "<0372004403ED03EF03F4>Tj"
    
    #  tj2 -  tj_mid  tj2,  tj2 
    m138_pattern = r'<0372004403ED03EF03F4>Tj'
    m138_match = re.search(m138_pattern, stream_text, re.IGNORECASE)
    if m138_match:
        tj2_pos = m138_match.start()
        tj2_end = m138_match.end()
        
        #  tj_mid  tj2
        # tj_mid_tj : "\n/C2_2 8 Tf\n{tj_mid_td_offset}\n<{tj_mid_cid}>Tj"
        # tj_mid 
        if has_tj_mid:
            tj_mid_end_pos = new_tj1_end + len(tj_mid_tj)
        else:
            #  tj_mid , tj2  tj1 
            tj_mid_end_pos = new_tj1_end
        
        #  tj2
        # tj2 ()
        #  tj_mid  tj2( /C2_1 )
        if tj2_cid:
            new_tj2_insert = f"\n/C2_1 8 Tf\n{new_x_offset:.3f} 0 Td\n{new_tj2}"
            stream_text = stream_text[:tj_mid_end_pos] + new_tj2_insert + stream_text[tj_mid_end_pos:]
            
            #  tj2 ()
            tj2_pos += len(new_tj2_insert)
            tj2_end += len(new_tj2_insert)
        
        #  tj2 ()
        empty_tj2 = '<00030003000300030003>Tj'  # 5
        stream_text = stream_text[:tj2_pos] + empty_tj2 + stream_text[tj2_end:]


    # 
    new_stream = stream_text.encode('latin-1')
    doc.update_stream(content_xref, new_stream)

    return True


def text_to_cid_hex(text):
    """
    CID(, )
    
    Args:
        text: ,  "15-04-2026"
    
    Returns:
        str: CID()
    """
    result = []
    for char in text:
        if char in DATE_CHAR_TO_CID:
            result.append(DATE_CHAR_TO_CID[char].lower())
        else:
            result.append('0003')
    return ''.join(result)


def text_to_cid_hex_lc_style(text):
    """
    Convert text to CID hex for LC template style.
    Uses the same CID encoding as C2_2 font (non-swapped).
    
    Args:
        text: Date string like "03-05-2026"
    
    Returns:
        str: CID hex string (no byte swapping)
    """
    # C2_2 font uses these CID values (from ToUnicode CMap)
    # Original CMap has: 0372 -> hyphen, 0358 is not in original
    # We add mappings for 0357, 0358 to hyphen as well
    char_map = {
        '0': '03EC', '1': '03ED', '2': '03EE', '3': '03EF',
        '4': '03F0', '5': '03F1', '6': '03F2', '7': '03F3',
        '8': '03F4', '9': '03F5', '-': '0372', '.': '0372',  # '-' -> 0372 (from original CMap)
        ' ': '0003'
    }
    result = []
    for char in text:
        if char in char_map:
            result.append(char_map[char])
        else:
            result.append('0003')
    
    return ''.join(result)


def time_to_cid_hex(text):
    """
    CID(, )
    
    Args:
        text: ,  " 01:43:17 PM"
    
    Returns:
        str: CID()
    """
    result = []
    for char in text:
        if char in TIME_CHAR_TO_CID:
            result.append(TIME_CHAR_TO_CID[char].lower())  # 
        else:
            result.append('0003')
    return ''.join(result)


def date_to_cid_hex(date_str):
    """Convert date string (DD-MM-YYYY) to CID hex string for C2_4 font"""
    DATE_CID_MAP = {
        '0': '03EC', '1': '03ED', '2': '03EE', '3': '03EF',
        '4': '03F0', '5': '03F1', '6': '03F2', '7': '03F3',
        '8': '03F4', '9': '03F5', '-': '0372'
    }
    cid = ''
    for char in date_str:
        cid += DATE_CID_MAP.get(char, '0003')
    return cid.upper()


def replace_dates_times_with_text_drawing(page, records, start_idx):
    """
     PyMuPDF 
     CID 
    
    Args:
        page: PDF 
        records: 
        start_idx: 
    
    Returns:
        int: 
    """
    import re
    import fitz
    
    # 
    text_dict = page.get_text("dict")
    
    # 
    text_blocks = []
    for block in text_dict.get("blocks", []):
        if "lines" in block:
            for line in block["lines"]:
                for span in line["spans"]:
                    text = span["text"].strip()
                    bbox = span["bbox"]
                    x = (bbox[0] + bbox[2]) / 2  #  x
                    y = bbox[1]  #  y
                    text_blocks.append({
                        'text': text,
                        'x': x,
                        'y': y,
                        'bbox': bbox
                    })
    
    # 
    # : DD-MM-YYYY,  x  320
    # : HH:MM:SS AM,  x > 360
    
    date_positions = []
    time_positions = []
    
    for block in text_blocks:
        text = block['text']
        x = block['x']
        y = block['y']
        
        #  (4)
        if re.match(r'^\d{2}-\d{2}-\d{4}$', text):
            date_positions.append({'x': x, 'y': y, 'text': text})
        
        #  (AM/PM)
        if re.match(r'^\s*\d{2}:\d{2}:\d{2}\s*[AP]M$', text):
            time_positions.append({'x': x, 'y': y, 'text': text})
    
    # 
    for i, record in enumerate(records):
        if start_idx + i >= len(date_positions):
            break
        
        date_time = record.get('date_time', '')
        if not date_time:
            continue
        
        parts = date_time.split(' ')
        if len(parts) < 2:
            continue
        
        date_str = parts[0]  # DD-MM-YYYY
        time_str = ' '.join(parts[1:])  # HH:MM:SS AM
        
        # 
        if i < len(date_positions):
            pos = date_positions[i]
            #  Calibri , 9pt
            try:
                # 
                clip = fitz.Rect(pos['x'] - 40, pos['y'] - 3, pos['x'] + 80, pos['y'] + 10)
                # 
                page.draw_rect(clip, color=(1, 1, 1), fill=(1, 1, 1))
                # 
                page.insert_text(
                    (pos['x'] - 35, pos['y'] + 3),
                    date_str,
                    fontname="helv",
                    fontsize=6,
                    color=(0, 0, 0)
                )
            except Exception as e:
                print(f"[DEBUG] : {e}", file=sys.stderr)
        
        # 
        if i < len(time_positions):
            pos = time_positions[i]
            try:
                clip = fitz.Rect(pos['x'] - 30, pos['y'] - 3, pos['x'] + 60, pos['y'] + 10)
                page.draw_rect(clip, color=(1, 1, 1), fill=(1, 1, 1))
                page.insert_text(
                    (pos['x'] - 25, pos['y'] + 3),
                    time_str,
                    fontname="helv",
                    fontsize=5,
                    color=(0, 0, 0)
                )
            except Exception as e:
                print(f"[DEBUG] : {e}", file=sys.stderr)
    
    return len(records)


def replace_times_in_page_stream(page, records, start_idx, std_tj_record_offset=1):
    """
     CID 
    
     PDF , 
    (Calibri). 
    
    : 
    1.  TJ : [<spacing><hex_cid>spacing<hex_cid>]TJ
    2.  Tj : <spacing><time_hex><spacing><AM/PM>Tj
    
    Args:
        page: PDF 
        records: 
        start_idx: 
    
    Returns:
        int: 
    """
    import re
    
    # 
    contents = page.get_contents()
    if not contents:
        print(f"[DEBUG] replace_times_in_page_stream: ", file=sys.stderr)
        return 0
    
    content_xref = contents[0]
    
    doc = page.parent
    # xref
    xref_len = doc.xref_length()
    if content_xref >= xref_len:
        print(f"[DEBUG] replace_times_in_page_stream: xref (xref={content_xref}, xref_length={xref_len})", file=sys.stderr)
        return 0
    
    stream = doc.xref_stream(content_xref)
    if stream is None:
        print(f"[DEBUG] replace_times_in_page_stream: ", file=sys.stderr)
        return 0
    
    stream_text = stream.decode('latin-1', errors='replace')
    
    # 
    # 1:  TJ 
    # [<0003><spacing1><time_hex><spacing2><pm_hex>]TJ
    time_pattern1 = r'\[<0003>([-.\d]+)<([0-9A-Fa-f]+0003)>([-.\d]+)<([0-9A-Fa-f]{8})>\]TJ'
    
    # 2:  Tj 
    # <spacing><time_hex><spacing><AM/PM>Tj
    # : <000303EC03F0035703F103F4035703EC03F5000300570044>Tj
    time_pattern2 = r'<([0-9A-Fa-f]+)(00570044|00040044)>Tj'
    
    matches1 = list(re.finditer(time_pattern1, stream_text, re.IGNORECASE))
    matches2 = list(re.finditer(time_pattern2, stream_text, re.IGNORECASE))
    
    total_matches = len(matches1) + len(matches2)
    
    if total_matches == 0:
        print(f"[DEBUG] replace_times_in_page_stream: ", file=sys.stderr)
        return 0
    
    print(f"[DEBUG] replace_times_in_page_stream:  {len(matches1)} TJ + {len(matches2)} Tj = {total_matches} ", file=sys.stderr)
    print(f"[DEBUG] replace_times_in_page_stream: records={len(records)}, start_idx={start_idx}", file=sys.stderr)
    
    # 
    all_replacements = []
    
    # 
    # 
    # 
    # 
    # 
    # 
    # 
    # 
    # 
    # 
    # 
    if len(records) > 0:
        record = records[0]
        date_time = record.get('date_time', '')
        if date_time:
            parts = date_time.split(' ')
            if len(parts) >= 1:
                date_part = parts[0]  # DD-MM-YYYY
                new_date_cid = date_to_cid_hex(date_part)
                
                # 
                # <03EE03F2037203EC03ED037203EE03EC03EE03F2>Tj
                # 
                # 
                # : <[0-9A-Fa-f]{40}>Tj
                # 
                # 
                # 
                # 
                date_tj_pattern = r'<([0-9A-Fa-f]{40})>Tj'
                date_tj_match = re.search(date_tj_pattern, stream_text, re.IGNORECASE)
                if date_tj_match:
                    old_date_hex = date_tj_match.group(1)
                    new_date_tj = f'<{new_date_cid.upper()}>Tj'
                    all_replacements.append({
                        'pos': date_tj_match.start(),
                        'length': len(date_tj_match.group()),
                        'new': new_date_tj,
                        'rec_idx': 0,
                        'pdf_row': 1,
                        'type': 'simple_date_tj'
                    })
                    print(f"[DEBUG] First date Tj: replaced '{old_date_hex}' -> '{new_date_cid.upper()}'", file=sys.stderr)
    
    # : TJPDF: 
    # - 0(simpleTj[0])-> PDF1()
    # - 1(stdTJ[0])-> PDF2
    # - 2(stdTJ[1])-> PDF3
    # ...
    # stdTJ[i]  PDF (i + 2)  -> record[i + 1]
    # simpleTj[0]  PDF1 -> record[0]
    # simpleTj[1]  PDF48 -> record[47]
    
    #  stdTJ 
    # Note: records is already sliced as records_original[start_idx:start_idx+n]

    #
    # 2. 处理其他行的日期 (在时间 TJ 之后)
    #
    # 时间 TJ 模式: [<0003>-spacing<time_hex>-spacing<pm_hex>]TJ
    #
    time_tj_pattern = r'\[<0003>(-[0-9.]+)<([0-9A-Fa-f]+)>-111\.875<([0-9A-Fa-f]{8})>\]TJ'
    time_tj_matches = list(re.finditer(time_tj_pattern, stream_text, re.IGNORECASE))
    
    print(f"[DEBUG] Found {len(time_tj_matches)} time TJ patterns", file=sys.stderr)
    
    #
    # 对于每个时间 TJ 模式 (除了第一个)，找到它之后的日期 Tj
    #
    for i, time_match in enumerate(time_tj_matches):
        if i == 0:
            continue  # 第1行已在上面处理
        
        rec_idx = i  # stdTJ[i] -> record[i]
        
        if rec_idx >= len(records):
            continue
        
        record = records[rec_idx]
        date_time = record.get('date_time', '')
        
        if not date_time:
            continue
        
        parts = date_time.split(' ')
        if len(parts) < 1:
            continue
        
        date_part = parts[0]
        new_date_cid = date_to_cid_hex(date_part)
        
        #
        # 在时间 TJ 之后查找日期 Tj 模式
        #
        search_start = time_match.end()
        search_end = min(len(stream_text), search_start + 200)
        context_after = stream_text[search_start:search_end]
        
        # 查找日期 Tj: 在 "-82.225 -15 Td" 之后紧跟 "<40-hex>Tj"
        date_tj_after_pattern = r'(-82\.225 -15 Td\n)<([0-9A-Fa-f]{40})>Tj'
        date_tj_match = re.search(date_tj_after_pattern, context_after, re.IGNORECASE)
        
        if date_tj_match:
            old_date_hex = date_tj_match.group(2)
            positioning_prefix = date_tj_match.group(1)
            # 计算在原始 stream 中的位置
            offset_in_context = date_tj_match.start()
            actual_pos = search_start + offset_in_context
            
            new_date_tj = f'{positioning_prefix}<{new_date_cid.upper()}>Tj'
            all_replacements.append({
                'pos': actual_pos,
                'length': len(date_tj_match.group()),
                'new': new_date_tj,
                'rec_idx': rec_idx,
                'pdf_row': i + 1,
                'type': 'simple_date_tj_rowN'
            })
            print(f"[DEBUG] Row {i+1} date Tj: replaced '{old_date_hex}' -> '{new_date_cid.upper()}'", file=sys.stderr)
    
    for i, match in enumerate(matches1):
        # MPO/Cat5e keep row 1 in a simple Tj and stdTJ[0] starts at row 2.
        # LC starts Date & Time rows directly with stdTJ[0].
        rec_idx = i + std_tj_record_offset
        
        if rec_idx >= len(records):
            continue
        
        record = records[rec_idx]
        date_time = record.get('date_time', '')
        
        if not date_time:
            continue
        
        parts = date_time.split(' ')
        if len(parts) < 3:
            continue
        
        time_str = ' ' + ' '.join(parts[1:])
        new_time_cid = time_to_cid_hex(time_str)
        new_time_hex = new_time_cid[4:-12] + "0003"
        
        # 
        original_spacing1 = match.group(1)
        original_spacing2 = match.group(3)
        
        if 'PM' in parts[2].upper():
            pm_hex_to_use = '00570044'
        else:
            pm_hex_to_use = '00040044'
        
        new_tj_block = f"[<0003>{original_spacing1}<{new_time_hex.upper()}>{original_spacing2}<{pm_hex_to_use}>]TJ"
        
        all_replacements.append({
            'pos': match.start(),
            'length': len(match.group()),
            'new': new_tj_block,
            'rec_idx': rec_idx,
            'pdf_row': i + 2
        })
        print(f"[DEBUG] stdTJ[{i}]: PDF{i + 1 + std_tj_record_offset} -> record[{rec_idx}], time='{time_str}'", file=sys.stderr)
    
    #  simpleTj[0] (PDF1, record[0])
    # :  Tj  TJ 
    # TJ : [<0003>-spacing1<time_hex>-spacing2<pm_hex>]TJ
    #  spacing1  spacing2 (-105.625  -111.875)
    if len(matches2) > 0 and len(records) > 0:
        match = matches2[0]
        # Note: records is already sliced. MPO/Cat5e use this for row 1;
        # LC uses it for the final row after all standard TJ rows.
        rec_idx = 0 if std_tj_record_offset == 1 else len(matches1)
        
        if rec_idx < len(records):
            record = records[rec_idx]
            date_time = record.get('date_time', '')
            
            if date_time:
                parts = date_time.split(' ')
                if len(parts) >= 3:
                    time_str = ' ' + ' '.join(parts[1:])
                    new_time_cid = time_to_cid_hex(time_str)
                    
                    #  TJ 
                    # : [<0003>-105.625<time_hex>-111.875<pm_hex>]TJ
                    time_hex = new_time_cid[4:-8].upper()  # 
                    pm_hex = '00570044' if 'PM' in time_str.upper() else '00040044'
                    
                    #  TJ 
                    # : [<0003>-105.625<time_hex>-111.875<pm_hex>]TJ
                    # NOTE: Date is handled separately in simple Tj, so use space here
                    date_cid = '0003'  # space - date is in separate Tj
                    
                    new_tj = f"[<{date_cid}>-105.625<{time_hex}>-111.875<{pm_hex}>]TJ"
                    
                    all_replacements.append({
                        'pos': match.start(),
                        'length': len(match.group()),
                        'new': new_tj,
                        'rec_idx': rec_idx,
                        'pdf_row': 1
                    })
                    print(f"[DEBUG] simpleTj[0] -> TJ: PDF1 -> record[{rec_idx}], time='{time_str}'", file=sys.stderr)
    
    #  simpleTj[1] (PDF48, record[47])
    # :  Tj  TJ 
    # Note: records is already sliced, so we just check if len >= 48
    if len(matches2) > 1 and len(records) >= 48:
        match = matches2[1]
        rec_idx = 47
        
        if rec_idx < len(records):
            record = records[rec_idx]
            date_time = record.get('date_time', '')
            
            if date_time:
                parts = date_time.split(' ')
                if len(parts) >= 3:
                    time_str = ' ' + ' '.join(parts[1:])
                    new_time_cid = time_to_cid_hex(time_str)
                    
                    # Get new time CID
                    # Must ensure it has trailing space to match original format
                    new_time_cid = time_to_cid_hex(' ' + time_str) + '0003'
                    
                    # TJ format: [<date>-spacing<time>-spacing<pm>]TJ
                    # time part should be 12 chars (HH:MM:SS)
                    # new_time_cid format: "0003" + HH:MM:SS + "0003"
                    # Extract HH:MM:SS part (skip first 4, exclude last 4)
                    time_hex = new_time_cid[4:-4].upper()[:12].ljust(12, '0')
                    pm_hex = '00570044' if 'PM' in time_str.upper() else '00040044'
                    
                    # Get date CID
                    date_cid = '0003'  # default to space
                    if date_time:
                        parts = date_time.split(' ')
                        if len(parts) >= 1:
                            date_part = parts[0]  # DD-MM-YYYY
                            date_cid = date_to_cid_hex(date_part)
                    
                    new_tj = f"[<{date_cid}>-105.625<{time_hex}>-111.875<{pm_hex}>]TJ"
                    
                    all_replacements.append({
                        'pos': match.start(),
                        'length': len(match.group()),
                        'new': new_tj,
                        'rec_idx': rec_idx,
                        'pdf_row': 48
                    })
                    print(f"[DEBUG] simpleTj[1] -> TJ: PDF48 -> record[{rec_idx}], time='{time_str}'", file=sys.stderr)
    
    # 
    all_replacements.sort(key=lambda x: x['pos'], reverse=True)
    
    # 
    for rep in all_replacements:
        old_pos = rep['pos']
        old_len = rep['length']
        new_content = rep['new']
        new_len = len(new_content)
        length_diff = new_len - old_len
        
        print(f"[DEBUG] : PDF{rep['pdf_row']}, pos={old_pos}, old_len={old_len}, new_len={new_len}, diff={length_diff}", file=sys.stderr)
        
        # 
        for other in all_replacements:
            if other['pos'] > old_pos:
                other['pos'] += length_diff
        
        # ( stream )
        stream_text = stream_text[:old_pos] + new_content + stream_text[old_pos + old_len:]
        print(f"[DEBUG] : PDF{rep['pdf_row']}, ={rep['pos']}", file=sys.stderr)
    
    processed = len(all_replacements)
    
    # 
    if processed > 0:
        new_stream = stream_text.encode('latin-1')
        doc.update_stream(content_xref, new_stream)
        # :  clean_contents(),  ToUnicode 
        # page.clean_contents()
        print(f"[DEBUG] replace_times_in_page_stream:  {processed} ", file=sys.stderr)
    
    return processed


def _fix_missing_glyphs_in_font(doc):
    """
    Fix QTEATX+Calibri font by replacing its FontFile2 with a font that has complete glyphs.
    
    Problem: QTEATX+Calibri's FontFile2 is missing glyph data for digits 4,5,7,8,9.
    Solution: Find another font with complete glyphs and use it directly instead of QTEATX.
    """
    print("[DEBUG] _fix_missing_glyphs_in_font: Starting font glyph fix", file=sys.stderr)
    
    import zlib
    import struct
    
    def get_fontfile2_stream(font_xref, doc):
        """Get FontFile2 stream data for a given font xref."""
        font_obj = doc.xref_object(font_xref)
        
        # Find DescendantFonts
        desc_match = re.search(r'/DescendantFonts\s+\[\s*(\d+)', font_obj)
        if not desc_match:
            return None, None, None
        
        cid_xref = int(desc_match.group(1))
        cidfont_obj = doc.xref_object(cid_xref)
        
        # Handle indirect reference
        cidfont_str = cidfont_obj.strip()
        if cidfont_str.startswith('[') or cidfont_str.startswith('<'):
            match = re.search(r'(\d+)\s+0\s+R', cidfont_str)
            if match:
                cid_xref = int(match.group(1))
                cidfont_obj = doc.xref_object(cid_xref)
        
        # Find FontDescriptor
        fd_match = re.search(r'/FontDescriptor\s+\[\s*(\d+)', cidfont_obj)
        if not fd_match:
            return None, None, None
        
        fd_xref = int(fd_match.group(1))
        fd_obj = doc.xref_object(fd_xref)
        
        # Handle indirect reference for FontDescriptor
        fd_str = fd_obj.strip()
        if fd_str.startswith('[') or not fd_str.startswith('<<'):
            match = re.search(r'(\d+)\s+0\s+R', fd_str)
            if match:
                fd_xref = int(match.group(1))
                fd_obj = doc.xref_object(fd_xref)
        
        # Find FontFile2
        ff_match = re.search(r'/FontFile2\s+\[\s*(\d+)', fd_obj)
        if not ff_match:
            return None, None, None
        
        ff_xref = int(ff_match.group(1))
        ff_str = doc.xref_object(ff_xref).strip()
        if ff_str.startswith('[') or not ff_str.startswith('<<'):
            match = re.search(r'(\d+)\s+0\s+R', ff_str)
            if match:
                ff_xref = int(match.group(1))
        
        # Get stream data
        raw_data = doc.xref_stream_raw(ff_xref)
        if not raw_data:
            return None, None, None
        
        # Try to decompress
        try:
            font_data = zlib.decompress(raw_data)
        except:
            font_data = raw_data
        
        return ff_xref, font_data, fd_xref
    
    def has_complete_glyphs(font_data):
        """Check if FontFile2 has complete glyph data for digit 5."""
        if not font_data or len(font_data) < 100:
            return False
        
        # Check TTF signature
        sig = struct.unpack('>I', font_data[0:4])[0]
        if sig != 0x00010000:
            return False
        
        # Parse tables
        num_tables = struct.unpack('>H', font_data[4:6])[0]
        
        loca_offset = None
        head_offset = None
        
        for i in range(num_tables):
            offset = 12 + i * 16
            tag = font_data[offset:offset+4].decode('ascii', errors='replace')
            table_offset = struct.unpack('>I', font_data[offset+8:offset+12])[0]
            
            if tag == 'loca':
                loca_offset = table_offset
            elif tag == 'head':
                head_offset = table_offset
        
        if loca_offset is None or head_offset is None:
            return False
        
        # Get loca format
        loca_type = struct.unpack('>H', font_data[head_offset+50:head_offset+52])[0]
        
        # Get loca table
        loca_data = font_data[loca_offset:loca_offset + 300000]
        
        # Check CID 0x03F1 (digit 5) has glyph data
        cid = 0x03F1
        try:
            if loca_type == 1:
                glyph_offset = struct.unpack('>I', loca_data[cid*4:(cid+1)*4])[0]
                next_offset = struct.unpack('>I', loca_data[(cid+1)*4:(cid+2)*4])[0]
            else:
                glyph_offset = struct.unpack('>H', loca_data[cid*2:(cid+1)*2])[0] * 2
                next_offset = struct.unpack('>H', loca_data[(cid+1)*2:(cid+2)*2])[0] * 2
            
            return (next_offset - glyph_offset) > 0
        except:
            return False
    
    # Find fonts with and without complete glyphs
    fonts_to_fix = []  # List of (page_num, font_xref, font_name, c2_name, ff_xref)
    fonts_with_glyphs = []  # List of (ff_xref, font_data)
    
    for page_num in range(len(doc)):
        page_xref = doc.page_xref(page_num)
        if page_xref is None:
            continue
        
        page_obj = doc.xref_object(page_xref)
        
        # Find all font references and their C2 names
        font_refs = re.findall(r'/([A-Z0-9_]+)\s+(\d+)\s+0\s+R', page_obj)
        
        for c2_name, font_xref_str in font_refs:
            if not c2_name.startswith('C2_'):
                continue
            
            font_xref = int(font_xref_str)
            ff_xref, font_data, fd_xref = get_fontfile2_stream(font_xref, doc)
            
            if ff_xref is None:
                continue
            
            # Check if QTEATX
            font_obj = doc.xref_object(font_xref)
            is_qteatx = '/BaseFont' in font_obj and 'QTEATX' in font_obj
            
            if is_qteatx:
                fonts_to_fix.append((page_num, font_xref, 'QTEATX+Calibri', c2_name, ff_xref, fd_xref))
            elif has_complete_glyphs(font_data):
                fonts_with_glyphs.append((ff_xref, font_data, fd_xref))
    
    if not fonts_to_fix:
        print("[DEBUG] No fonts to fix", file=sys.stderr)
        return True
    
    if not fonts_with_glyphs:
        print("[DEBUG] No fonts with complete glyphs found", file=sys.stderr)
        return False
    
    # Use the first font with complete glyphs as donor
    donor_ff_xref, donor_data, donor_fd_xref = fonts_with_glyphs[0]
    print(f"[DEBUG] Donor font: FontFile2 xref={donor_ff_xref}, fd_xref={donor_fd_xref}", file=sys.stderr)
    
    # For each font to fix, update its FontDescriptor to point to donor FontFile2
    for page_num, font_xref, font_name, c2_name, old_ff_xref, fd_xref in fonts_to_fix:
        print(f"[DEBUG] Fixing {font_name} ({c2_name}): fd_xref={fd_xref}, old_ff_xref={old_ff_xref}", file=sys.stderr)
        
        try:
            # Get FontDescriptor object
            fd_obj = doc.xref_object(fd_xref)
            
            # Update FontFile2 reference to point to donor
            # Change "/FontFile2 old_ff_xref 0 R" to "/FontFile2 donor_ff_xref 0 R"
            new_fd_obj = re.sub(
                r'/FontFile2\s+\d+\s+0\s+R',
                f'/FontFile2 {donor_ff_xref} 0 R',
                fd_obj
            )
            
            if new_fd_obj != fd_obj:
                doc.update_object(fd_xref, new_fd_obj)
                print(f"[DEBUG] Updated FontDescriptor {fd_xref} to point to donor FontFile2", file=sys.stderr)
            else:
                print(f"[DEBUG] FontDescriptor not changed", file=sys.stderr)
        
        except Exception as e:
            print(f"[DEBUG] Error updating font: {e}", file=sys.stderr)
            return False
    
    print("[DEBUG] Font glyph fix completed successfully", file=sys.stderr)
    return True


def _fix_lc_template_date(template_doc):
    """
    Fix corrupted date Tj values in LC template data pages.
    
    One LC template page contains a malformed placeholder that renders as
    "3-5-234-". Normalize it to a full-length date placeholder so the normal
    per-record date replacement can safely overwrite it.
    """
    if len(template_doc) < 2:
        return
    
    corrupt_tj = '<03EF037203F1037203EE03EF03F00372>Tj'
    correct_tj = '<03EC03F0037203EC03F1037203EE03EC03EE03F2>Tj'
    replaced = 0

    try:
        for page_idx in range(len(template_doc) - 1):
            page = template_doc[page_idx]
            for content_xref in page.get_contents() or []:
                stream = template_doc.xref_stream(content_xref)
                if stream is None:
                    continue

                stream_text = stream.decode('latin-1', errors='replace')
                if corrupt_tj not in stream_text:
                    continue

                new_stream_text = stream_text.replace(corrupt_tj, correct_tj)
                template_doc.update_stream(content_xref, new_stream_text.encode('latin-1'))
                replaced += stream_text.count(corrupt_tj)

        if replaced:
            print(f"[DEBUG] Fixed {replaced} corrupted LC date placeholder(s)", file=sys.stderr)
    except Exception as e:
        print(f"[DEBUG] Failed to fix LC date placeholder: {e}", file=sys.stderr)
        pass


def _fix_f2_cmap_for_dates(doc):
    """
    Fix C2_1, C2_2, and C2_4 fonts' ToUnicode CMap to add missing digit mappings.
    These fonts use CID for Calibri but their CMaps are missing some digit mappings.
    
    Original CMap uses bfchar format: <CID> <Unicode> (with space)
    We need to add: <03F0> (4), <03F1> (5), <03F3> (7), <03F4> (8), <03F5> (9)
    
    Note: This function tracks all unique ToUnicode objects by their xref
    to ensure shared fonts across pages are fixed only once.
    """
    # All these fonts need the same digit mappings (uppercase CID, with space like original)
    new_mappings = [
        ('03F0', '0034'),  # 4
        ('03F1', '0035'),  # 5
        ('03F3', '0037'),  # 7
        ('03F4', '0038'),  # 8
        ('03F5', '0039'),  # 9
    ]
    
    # Track fixed ToUnicode xrefs to avoid duplicate fixes
    fixed_tu_xrefs = set()
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        page_xref = page.xref
        
        page_obj = doc.xref_object(page_xref)
        
        # Find C2_1, C2_2, C2_4 font references
        for font_name in ['C2_1', 'C2_2', 'C2_4']:
            c2_match = re.search(rf'/{font_name}\s+(\d+)\s+0\s+R', page_obj)
            if not c2_match:
                continue
            
            c2_xref = int(c2_match.group(1))
            font_obj = doc.xref_object(c2_xref)
            
            # Find ToUnicode reference (direct or indirect)
            tu_match = re.search(r'/ToUnicode\s+(\d+)', font_obj)
            if not tu_match:
                continue
            
            tu_xref = int(tu_match.group(1))
            
            # Skip if already fixed
            if tu_xref in fixed_tu_xrefs:
                continue
            
            tu_stream = doc.xref_stream(tu_xref)
            if not tu_stream:
                continue
            
            tu_text = tu_stream.decode('latin-1', errors='replace')
            
            # Check if we need to add any mappings
            missing_mappings = []
            for cid, unicode_val in new_mappings:
                # Check if this CID has ANY mapping (uppercase or lowercase)
                if f'<{cid}>' not in tu_text and f'<{cid.lower()}>' not in tu_text:
                    missing_mappings.append((cid, unicode_val))
            
            if not missing_mappings:
                fixed_tu_xrefs.add(tu_xref)
                continue
            
            # Find position to insert (before endbfchar or endbfrange)
            insert_pos = tu_text.rfind('endbfchar')
            if insert_pos < 0:
                insert_pos = tu_text.rfind('endbfrange')
            if insert_pos < 0:
                insert_pos = tu_text.rfind('endcmap')
            
            # Determine format: use space if original uses space, otherwise no space
            # Check first entry to determine format
            if '<0003> <0020>' in tu_text or '<03EC> <0030>' in tu_text:
                # Original uses space format: <CID> <Unicode>
                format_str = '<{cid}> <{unicode}>\n'
            else:
                # Original uses no space format: <CID><Unicode>
                format_str = '<{cid}><{unicode}>\n'
            
            # Add missing mappings
            additions = ''
            for cid, unicode_val in missing_mappings:
                additions += format_str.format(cid=cid, unicode=unicode_val)
            
            new_cmap = tu_text[:insert_pos] + additions + tu_text[insert_pos:]
            doc.update_stream(tu_xref, new_cmap.encode('latin-1'))
            fixed_tu_xrefs.add(tu_xref)
            print(f"[DEBUG] Fixed {font_name} CMap (tu_xref={tu_xref}) for dates - added {len(missing_mappings)} mappings", file=sys.stderr)


def _get_date_positions_before_redaction(page):
    """
    Get date positions from the page BEFORE redaction.
    Returns list of dicts with position and text info.
    """
    date_positions = []
    
    # Get date positions from the page
    # Dates are in the last column, around x=324-350, y varies per row
    d = page.get_text("dict")
    
    for block in d.get("blocks", []):
        if block.get("type") == 0:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    bbox = span.get("bbox", [])
                    if text.strip() and '2026' in text and len(text) > 8:
                        # This is a date span
                        x = (bbox[0] + bbox[2]) / 2
                        y = (bbox[1] + bbox[3]) / 2
                        # Check if it's in the date column (around x=320-350)
                        if 300 < x < 380:
                            date_positions.append({
                                'text': text.strip(),
                                'x': x,
                                'y': y,
                                'bbox': list(bbox),
                                'font_size': bbox[3] - bbox[1]
                            })
    
    # Sort by y position (top to bottom)
    date_positions.sort(key=lambda s: s['y'])
    
    return date_positions


def _get_date_positions_after_redaction(page):
    """
    Get date positions from the page AFTER redaction.
    Returns list of dicts with position and text info.
    """
    date_positions = []
    
    # Get date positions from the page
    # Dates are in the last column, around x=324-350, y varies per row
    d = page.get_text("dict")
    
    for block in d.get("blocks", []):
        if block.get("type") == 0:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    bbox = span.get("bbox", [])
                    if text.strip() and '2026' in text and len(text) > 8:
                        # This is a date span
                        x = (bbox[0] + bbox[2]) / 2
                        y = (bbox[1] + bbox[3]) / 2
                        # Check if it's in the date column (around x=320-350)
                        if 300 < x < 380:
                            date_positions.append({
                                'text': text.strip(),
                                'x': x,
                                'y': y,
                                'bbox': list(bbox),
                                'font_size': bbox[3] - bbox[1]
                            })
    
    # Sort by y position (top to bottom)
    date_positions.sort(key=lambda s: s['y'])
    
    return date_positions


def _draw_dates_at_positions(page, records, date_positions, start_idx=0, all_records=None):
    """
    Draw date values at specified positions using PyMuPDF insert_text.
    This draws dates AFTER redaction when the original Tj patterns are gone.
    Uses the original Calibri Bold font from the template.
    """
    if not date_positions:
        return 0
    
    drawn = 0
    effective_records = all_records if all_records is not None else records
    total_records = len(effective_records)
    
    if total_records == 0:
        return 0
    
    # Build list of date strings for each position
    date_strings = []
    for i, pos in enumerate(date_positions):
        # Note: records is already sliced, so use i directly
        rec_idx = i
        
        if rec_idx < len(effective_records):
            record = effective_records[rec_idx]
        elif effective_records:
            record = effective_records[rec_idx % len(effective_records)]
        else:
            record = {}
        
        date_time = record.get('date_time', '') if record else ''
        
        # Extract date part
        if ' ' in date_time:
            date_part = date_time.split(' ')[0]  # "03-05-2026"
        else:
            date_part = date_time
        
        date_strings.append(date_part)
    
    if not date_strings:
        return 0
    
    # Get the first content stream to check if C2_4 font is available
    doc = page.parent
    contents = page.get_contents()
    if not contents:
        return 0
    
    # Try to find C2_4 font in the page resources
    page_obj = doc.xref_object(page.xref)
    c2_4_available = '/C2_4' in page_obj
    
    # Use Helvetica-Bold as fallback (standard PDF font)
    # The original uses C2_4 (Calibri Bold), but after redaction only C2_2 is available
    # Helvetica-Bold is a standard PDF font that should work
    fontname = "Helvetica-Bold"
    
    # Use insert_text to draw dates
    # The dates are at positions where the original dates were
    for i, pos in enumerate(date_positions):
        if i >= len(date_strings):
            break
        
        date_str = date_strings[i]
        if not date_str:
            continue
        
        # Get position from the stored date position
        bbox = pos.get('bbox', [])
        if len(bbox) < 4:
            continue
        
        # Use the original position
        # x = left edge of date text, y = baseline
        x = bbox[0]  # Left edge
        baseline_y = bbox[3] - 2  # Bottom edge minus small offset for baseline
        
        # Use fixed fontsize of 8.0 to match template
        fontsize = 8.0
        
        # Insert text at the original position
        try:
            page.insert_text(
                fitz.Point(x, baseline_y),
                date_str,
                fontname=fontname,
                fontsize=fontsize
            )
            drawn += 1
        except Exception as e:
            print(f"[ERROR] Failed to insert date text: {e}", file=sys.stderr)
    
    return drawn



def replace_dates_in_page_stream(page, records, start_idx):
    """
    Replace date values in PDF content stream using CID encoding.
    Handles multiple content streams created by apply_redactions().
    
    Dates use TJ format: [<hex1>-offset<hex2>-offset<hex3>]TJ
    Example: [<0003>-105.625<03EC...>-111.875<0057...>]TJ
    - hex1: 4 chars (usually space)
    - hex2: 36 chars (date data with 0358 separators)
    - hex3: 8 chars (time data)
    """
    if not records:
        return 0
    
    page_num = page.number
    if page_num < 0:
        return 0
    
    # Fix F2 font's ToUnicode CMap to add missing digit mappings
    # DISABLED: This was causing rendering issues with dates
    # _fix_f2_cmap_for_dates(page.parent)
    
    try:
        contents = page.get_contents()
        if not contents:
            return 0
    except Exception:
        return 0
    
    total_processed = 0
    
    # Process each content stream
    for content_xref in contents:
        try:
            stream = page.parent.xref_stream(content_xref)
            if not stream:
                continue
        except Exception:
            continue
        
        stream_bytes = bytearray(stream)
        
        # Find date patterns: hex1 is small (4 chars), hex2 is large (32-40 chars), hex3 is small
        date_pattern = rb'\[<[0-9A-Fa-f]{4}>-[0-9.]+<[0-9A-Fa-f]{32,40}>-[0-9.]+<[0-9A-Fa-f]+>\]TJ'
        
        # Find all dates
        matches = []
        pos = 0
        while True:
            match = re.search(date_pattern, stream_bytes[pos:], re.IGNORECASE)
            if not match:
                break
            matches.append((pos + match.start(), pos + match.end()))
            pos = pos + match.end()
        
        if not matches:
            continue
        
        processed = 0
        
        # Replace dates from end to start
        for i, (start, end) in enumerate(reversed(matches)):
            # Note: records is already sliced, so use i directly
            rec_idx = i
            
            # Get date from record
            # Support both 'date_time' and 'date' + 'time' fields
            date_part = ''
            time_part = ''
            if rec_idx < len(records):
                record = records[rec_idx]
                # Try 'date_time' first (combined field)
                date_time = record.get('date_time', '')
                if date_time:
                    parts = date_time.split(' ', 1)
                    date_part = parts[0] if parts else ''
                else:
                    # Fall back to separate 'date' and 'time' fields
                    date_part = record.get('date', '')
                    time_part = record.get('time', '')
            
            # Convert date to CID
            if date_part:
                cid_hex = text_to_cid_hex_lc_style(date_part)
            else:
                cid_hex = '0003' * 10
            
            # Ensure 40 chars
            if len(cid_hex) < 40:
                cid_hex = cid_hex + '0003' * (10 - len(cid_hex) // 4)
            elif len(cid_hex) > 40:
                cid_hex = cid_hex[:40]
            
            # Extract original pattern parts
            old_tj = bytes(stream_bytes[start:end])
            old_text = old_tj.decode('latin-1', errors='replace')
            
            # Extract hex1, hex3, and offsets
            hex1_match = re.search(r'\[<([0-9A-Fa-f]+)>-', old_text)
            hex3_match = re.search(r'<([0-9A-Fa-f]+)>\]TJ$', old_text)
            
            if not hex1_match or not hex3_match:
                continue
            
            hex1 = hex1_match.group(1)[:4].upper()
            hex3 = hex3_match.group(1)[:8].upper()
            
            offsets = re.findall(r'>(-[0-9.]+)', old_text)
            offset1 = offsets[0] if len(offsets) > 0 else '-105.625'
            offset2 = offsets[1] if len(offsets) > 1 else '-111.875'
            
            # Build new TJ
            new_tj_text = f'[<{hex1}>-{offset1}<{cid_hex}>-{offset2}<{hex3}>]TJ'
            new_tj = new_tj_text.encode('latin-1')
            
            # Match length
            orig_len = len(old_tj)
            new_len = len(new_tj)
            
            if new_len < orig_len:
                new_tj = new_tj + b' ' * (orig_len - new_len)
            elif new_len > orig_len:
                new_tj = new_tj[:orig_len]
            
            stream_bytes[start:end] = new_tj
            processed += 1
        
        if processed > 0:
            try:
                page.parent.update_stream(content_xref, bytes(stream_bytes))
                total_processed += processed
            except Exception:
                pass
    
    return total_processed


def replace_dates_in_tj_format(page, records, start_idx):
    """
    Replace date values in PDF content stream using Tj format (simple hex, not array).
    The original template uses this format for dates in data pages.
    Format: <CID-hex>CID-hex>Tj (using C2_4 font = Calibri Bold)
    Example: <03EE03F2037203EC03ED037203EE03EC03EE03F2>Tj
    """
    if not records:
        return 0
    
    page_num = page.number
    if page_num < 0:
        return 0
    
    try:
        contents = page.get_contents()
        if not contents:
            return 0
    except Exception:
        return 0
    
    total_processed = 0
    
    # Convert date to CID using the C2_4 font mapping
    def date_to_c2_4_cid(date_str):
        """Convert date string to C2_4 CID hex (Calibri Bold)."""
        date_cid_map = {
            '0': '03EC', '1': '03ED', '2': '03EE', '3': '03EF',
            '4': '03F0', '5': '03F1', '6': '03F2', '7': '03F3',
            '8': '03F4', '9': '03F5', '-': '0372', '/': '0372'
        }
        cid = ''
        for char in date_str:
            cid += date_cid_map.get(char, '0003')  # space for unknown
        return cid.upper()
    
    # Process each content stream
    for content_xref in contents:
        try:
            stream = page.parent.xref_stream(content_xref)
            if not stream:
                continue
        except Exception:
            continue
        
        stream_text = stream.decode('latin-1', errors='replace')
        stream_bytes = bytearray(stream)
        
        # Find TJ patterns with date CIDs (used in LC template)
        # Pattern: [<date_hex>-num<time_hex>]TJ
        # The date_hex is 40 chars before the first hyphen
        tj_pattern = rb'\[<([0-9A-Fa-f]{40})-[\d.]+<'
        
        matches = list(re.finditer(tj_pattern, stream_bytes, re.IGNORECASE))
        
        if not matches:
            # Fall back to simple Tj format
            tj_pattern = rb'<([0-9A-Fa-f]{40})>Tj'
            matches = list(re.finditer(tj_pattern, stream_bytes, re.IGNORECASE))
        
        if not matches:
            continue
        
        print(f"[DEBUG] Page {page_num}: Found {len(matches)} TJ/Tj date patterns", file=sys.stderr)
        
        processed = 0
        
        # Calculate how many records we have to fill
        records_to_fill = min(len(records), len(matches))
        
        # Replace dates: the first N Tj patterns (from start) correspond to the first N records
        # We replace from start to preserve the absolute position of the first Tj
        for i in range(records_to_fill):
            match = matches[i]  # Use forward order, not reversed
            
            # Get date from record
            # Support both 'date_time' and 'date' + 'time' fields
            # Note: records is already sliced as records_original[start_idx:start_idx+processed]
            # So we use records[i] directly, not records[record_idx]
            date_part = ''
            if i < len(records):
                record = records[i]
                # Try 'date_time' first (combined field)
                date_time = record.get('date_time', '')
                if date_time:
                    parts = date_time.split(' ', 1)
                    date_part = parts[0] if parts else ''
                else:
                    # Fall back to separate 'date' and 'time' fields
                    date_part = record.get('date', '')
            
            # Convert date to CID
            if date_part:
                cid_hex = date_to_c2_4_cid(date_part)
            else:
                cid_hex = '0003' * 10  # 10 spaces
            
            # Ensure 40 chars
            if len(cid_hex) < 40:
                cid_hex = cid_hex + '0003' * ((40 - len(cid_hex)) // 4)
            elif len(cid_hex) > 40:
                cid_hex = cid_hex[:40]
            
            # Replace date hex in TJ or Tj pattern
            start_pos = match.start()
            end_pos = match.end()
            match_text = match.group(0)
            
            # Detect format: TJ format starts with '[<', Tj format is '<...>Tj'
            if match_text.startswith(b'[<'):
                # TJ format: [<date_hex>-num<time_hex>]TJ
                # We need to find the date hex (first 40 hex chars) and replace it
                # Original: [<40hex>-num<hex>]TJ
                # New: [<new40hex>-num<hex>]TJ (keep the time part andTJ ending)
                
                # Find the hyphen after the first 40 hex chars
                match_body = match.group(1)  # 40 hex chars (date)
                # Get the rest: "-num<time_hex>]TJ"
                rest_start = match.start(1) + len(match_body)
                rest = stream_bytes[rest_start:end_pos]
                
                # Build new TJ
                new_content = f'[<{cid_hex}' + rest.decode('latin-1')
                new_bytes = new_content.encode('latin-1')
                
                # Keep original length
                orig_len = end_pos - start_pos
                new_len = len(new_bytes)
                if new_len < orig_len:
                    new_bytes = new_bytes + b' ' * (orig_len - new_len)
                elif new_len > orig_len:
                    new_bytes = new_bytes[:orig_len]
            else:
                # Simple Tj format: <40_hex_chars>Tj
                new_content = f'<{cid_hex}>Tj'
                new_bytes = new_content.encode('latin-1')
                
                orig_len = end_pos - start_pos
                new_len = len(new_bytes)
                if new_len < orig_len:
                    new_bytes = new_bytes + b' ' * (orig_len - new_len)
                elif new_len > orig_len:
                    new_bytes = new_bytes[:orig_len]
            
            stream_bytes[start_pos:end_pos] = new_bytes
            processed += 1
            print(f"[DEBUG] Replaced date at TJ {i}: {date_part} -> {cid_hex}", file=sys.stderr)
        
        if processed > 0:
            try:
                page.parent.update_stream(content_xref, bytes(stream_bytes))
                total_processed += processed
                print(f"[DEBUG] Updated {processed} Tj date patterns on page {page_num}", file=sys.stderr)
            except Exception as e:
                print(f"[DEBUG] Error updating stream: {e}", file=sys.stderr)
    
    return total_processed


# Cable Label  CID ( Calibri regular  ToUnicode)
# Cable Label  CID ( Calibri regular  ToUnicode)
#  PDF xref 619 
CABLE_CHAR_TO_CID = {
    '#': '03B7',  # '#' 
    '0': '03EC', '1': '03ED', '2': '03EE', '3': '03EF',
    '4': '03F0', '5': '03F1', '6': '03F2', '7': '03F3',
    '8': '03F4', '9': '03F5',
    '-': '0372',  # 
}

# Limit  CID ( Calibri (C2_3)  ToUnicode)
#  MPO  "200GBASE-SR10" 
LIMIT_CHAR_TO_CID = {
    '0': '03EC', '1': '03ED', '2': '03EE', '3': '03EF',
    '4': '03F0', '5': '03F1', '6': '03F2', '7': '03F3',
    '8': '03F4', '9': '03F5',
    'A': '0004', 'B': '0011', 'E': '001C', 'G': '0027',
    'R': '005A', 'S': '005E',
    '-': '0372',
    ' ': '0003',
}

# Cat5e  Limit  CID 
#  "TIA - Cat 5e Channel" 
CAT5E_LIMIT_CHAR_TO_CID = {
    'A': '0004', 'B': '0011', 'C': '0012', 'D': '0018',
    'E': '001C', 'I': '002F', 'M': '0044', 'P': '0057',
    'S': '005E', 'T': '0064', 'U': '0068',
    'a': '0102', 'd': '011A', 'e': '011E', 'g': '0150',
    'h': '015A', 'i': '015D', 'l': '016F', 'n': '0176',
    'o': '017D', 'p': '0189', 'r': '018C', 't': '019A',
    'u': '01B5', 'y': '0179',  #  y  Channel  y
    ':': '0357', '.': '0358', '/': '036C', '-': '0372',
    '0': '03EC', '1': '03ED', '2': '03EE', '3': '03EF',
    '4': '03F0', '5': '03F1', '6': '03F2', '7': '03F3',
    '8': '03F4', '9': '03F5',
    ' ': '0003',
}


def text_to_limit_cid(text, template_type='mpo'):
    """
    Convert Limit column text to CID hex string
    
    Args:
        text: Input text, e.g. "200GBASE-SR10" or "TIA - Cat 5e Channel"
        template_type: Template type ('mpo' or 'cat5e')
    
    Returns:
        str: CID hex string
    """
    char_to_cid = CAT5E_LIMIT_CHAR_TO_CID if template_type == 'cat5e' else LIMIT_CHAR_TO_CID
    result = []
    for char in text:
        # ()
        if char in char_to_cid:
            result.append(char_to_cid[char])
        # 
        elif char.upper() in char_to_cid:
            result.append(char_to_cid[char.upper()])
        else:
            result.append('0003')  # 
    return ''.join(result)


def _fit_cid_to_hex_length(cid_hex, target_len):
    """Pad or trim a CID hex string without repeating visible glyphs."""
    if len(cid_hex) < target_len:
        missing = target_len - len(cid_hex)
        cid_hex += '0003' * ((missing + 3) // 4)
    return cid_hex[:target_len]


LIMIT_CID_TO_CHAR = {cid: char for char, cid in LIMIT_CHAR_TO_CID.items()}


def _decode_mpo_limit_cid(hex_text):
    chars = []
    for i in range(0, len(hex_text), 4):
        chars.append(LIMIT_CID_TO_CHAR.get(hex_text[i:i + 4].upper(), ''))
    return ''.join(chars)


def text_to_cable_cid(text):
    """
     Cable Label  CID 
    
    Args:
        text: ,  "#1234"  "A-01"
    
    Returns:
        str: CID 
    """
    result = []
    for char in text.upper():  # 
        if char in CABLE_CHAR_TO_CID:
            result.append(CABLE_CHAR_TO_CID[char])
        else:
            result.append('0003')  # 
    return ''.join(result)


# Cable Label 
# Cable Label : <03B7<digits><space>>Tj
#  <digits>  CID , <space>  CID 0003
# : <03B703EE03EF03F40003>Tj  "#238 "
# :  trailing space,  <03B703EE03EF03F5>Tj  "#239"

# Cable Label CID 
CABLE_LABEL_CID = {
    '#': '03B7',
    '0': '03EC', '1': '03ED', '2': '03EE', '3': '03EF',
    '4': '03F0', '5': '03F1', '6': '03F2', '7': '03F3',
    '8': '03F4', '9': '03F5',
    ' ': '0003',
}


def cable_label_to_cid(text):
    """ Cable Label  CID """
    result = []
    for char in text:
        if char in CABLE_LABEL_CID:
            result.append(CABLE_LABEL_CID[char])
        else:
            # (),  CID
            result.append('0003')
    return ''.join(result)


def replace_cable_labels_in_page_stream(page, records, start_idx):
    """
     Cable Label 
    
    Cable Label  CID . 
    PDF : 
    matches[i]  PDF  i+1 ()
    
    Args:
        page: PDF 
        records: 
        start_idx: 
    
    Returns:
        int: 
    """
    import re
    
    # 
    contents = page.get_contents()
    if not contents:
        print(f"[DEBUG] replace_cable_labels_in_page_stream: ", file=sys.stderr)
        return 0
    
    content_xref = contents[0]
    
    doc = page.parent
    # xref
    xref_len = doc.xref_length()
    if content_xref >= xref_len:
        print(f"[DEBUG] replace_cable_labels_in_page_stream: xref (xref={content_xref}, xref_length={xref_len})", file=sys.stderr)
        return 0
    
    stream = doc.xref_stream(content_xref)
    if stream is None:
        print(f"[DEBUG] replace_cable_labels_in_page_stream: ", file=sys.stderr)
        return 0
    
    stream_bytes = bytearray(stream)
    stream_text = stream.decode('latin-1', errors='replace')
    
    # Cable Label : <03B7<digits>[0003]>Tj
    #  digits  3-4  CID 
    # : <03B703EE03EF03F40003>Tj  "#238 "
    # : CID, IGNORECASE
    # :  +  >Tj
    cable_pattern = re.compile(r'<03B7[0-9A-Fa-f]+>Tj', re.IGNORECASE)
    
    print(f"[DEBUG] Cable Label: stream_text={len(stream_text)}", file=sys.stderr)
    matches = list(re.finditer(cable_pattern, stream_text))
    print(f"[DEBUG] Cable Label:  {len(matches)} ", file=sys.stderr)
    
    if not matches:
        print(f"[DEBUG] replace_cable_labels_in_page_stream:  Cable Label ", file=sys.stderr)
        return 0
    
    print(f"[DEBUG] replace_cable_labels_in_page_stream:  {len(matches)}  Cable Label ", file=sys.stderr)
    print(f"[DEBUG] replace_cable_labels_in_page_stream: records={len(records)}, start_idx={start_idx}", file=sys.stderr)
    
    # : PDF 
    # matches[i]  PDF  i+1 ()
    # records[i]  PDF  i+1 
    processed = 0
    
    # 
    stream_bytes = bytearray(stream_text.encode('latin-1'))
    
    for i in range(len(matches)):
        # ()
        current_matches = list(re.finditer(cable_pattern, stream_bytes.decode('latin-1', errors='replace')))
        if i >= len(current_matches):
            break
        match = current_matches[i]
        
        # matches[i]  PDF  i+1 
        # Note: records is already sliced, so use i directly
        rec_idx = i
        
        if rec_idx >= len(records):
            continue
        
        record = records[rec_idx]
        cable_label = record.get('cable_label', '')
        
        if not cable_label:
            continue
        
        #  Cable Label  CID 
        label_cid = cable_label_to_cid(cable_label)
        new_tj = f"<{label_cid}>Tj".encode('latin-1')
        
        # 
        old_start = match.start()
        old_end = match.end()
        old_len = old_end - old_start
        new_len = len(new_tj)
        
        # 
        stream_bytes[old_start:old_end] = new_tj
        
        # ()
        # : Python 
        #  matches 
        
        processed += 1
        print(f"[DEBUG]  Cable Label {processed}: PDF{i + 1} record[{rec_idx}] = '{cable_label}' -> CID='{label_cid}'", file=sys.stderr)
    
    # 
    if processed > 0:
        new_stream = bytes(stream_bytes)
        doc.update_stream(content_xref, new_stream)
        # :  clean_contents(),  ToUnicode 
        # page.clean_contents()
        print(f"[DEBUG] replace_cable_labels_in_page_stream:  {processed} ", file=sys.stderr)
    
    return processed


def replace_limits_in_page_stream(page, records, start_idx, is_mpo_template=True):
    """
     Limit  CID 
    
     PDF  Limit , 
    (Calibri). 
    
    Args:
        page: PDF 
        records: 
        start_idx: 
        is_mpo_template:  MPO 
    
    Returns:
        int: 
    """
    import re
    
    # 
    contents = page.get_contents()
    if not contents:
        print(f"[DEBUG] replace_limits_in_page_stream: ", file=sys.stderr)
        return 0

    doc = page.parent

    if is_mpo_template:
        # MPO Limit values are written as CIDs such as "200GBASE-SR10".
        # They may live in any of the page's content streams after redactions,
        # so scan all streams and pick only CID runs that decode to a GBASE/SR
        # limit string.
        limit_pattern = re.compile(rb'<([0-9A-Fa-f]{40,64})>Tj', re.IGNORECASE)
    else:
        # Cat5e : C2_2 -8 Tf  Tm  -95.734 0 Td
        # : /C2_2 -8 Tf\n1 0 0 -1 x y Tm\n<xxx>Tj\n-95.734 0 Td\n<0064...>Tj
        limit_pattern = re.compile(rb'-95\.734 0 Td\s+<0064[0-9A-Fa-f]+>Tj', re.IGNORECASE)

    processed = 0

    seen_xrefs = set()
    for content_xref in contents:
        if content_xref in seen_xrefs:
            continue
        seen_xrefs.add(content_xref)

        xref_len = doc.xref_length()
        if content_xref >= xref_len:
            print(f"[DEBUG] replace_limits_in_page_stream: xref (xref={content_xref}, xref_length={xref_len})", file=sys.stderr)
            continue

        stream = doc.xref_stream(content_xref)
        if stream is None:
            continue

        stream_bytes = bytearray(stream)

        if is_mpo_template:
            matches = []
            for match in re.finditer(limit_pattern, stream_bytes):
                decoded = _decode_mpo_limit_cid(match.group(1).decode('latin-1'))
                normalized = decoded.replace(' ', '').upper()
                if 'GBASE' in normalized and 'SR' in normalized:
                    matches.append(match)
        else:
            matches = list(re.finditer(limit_pattern, stream_bytes))

        if not matches:
            continue

        print(
            f"[DEBUG] replace_limits_in_page_stream: xref={content_xref}, matches={len(matches)}, MPO={is_mpo_template}",
            file=sys.stderr
        )

        stream_processed = 0
        for match in matches:
            if processed >= len(records):
                break

            record = records[processed]
            limit = record.get('limit', '')
            if not limit:
                processed += 1
                continue

            new_cid = text_to_limit_cid(limit, 'cat5e' if not is_mpo_template else 'mpo')
            old_match_text = match.group()
            tj_start = old_match_text.rfind(b'<')
            old_hex = old_match_text[tj_start + 1:-3]
            new_cid = _fit_cid_to_hex_length(new_cid, len(old_hex))
            new_tj = f"<{new_cid}>Tj".encode('latin-1')
            replacement = old_match_text[:tj_start] + new_tj
            stream_bytes[match.start():match.end()] = replacement

            print(f"[DEBUG]  Limit {processed + 1}: record[{processed}] = '{limit}'", file=sys.stderr)
            processed += 1
            stream_processed += 1

        if stream_processed > 0:
            doc.update_stream(content_xref, bytes(stream_bytes))
            print(f"[DEBUG] replace_limits_in_page_stream: updated {stream_processed} in xref={content_xref}", file=sys.stderr)

        if processed >= len(records):
            break

    if processed == 0:
        print(f"[DEBUG] replace_limits_in_page_stream:  Limit  (MPO={is_mpo_template})", file=sys.stderr)
    
    return processed


# 
TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), '..', 'assets', 'M138-DE46-OOB-Cat5e.pdf')

# (MPO: 48, Cat5e: 46)
ROWS_PER_PAGE = 48

# (2, 1)
DATA_TEMPLATE_PAGE = 1

# Calibri
#  Calibri 
CARLITO_REGULAR = os.path.join(FONT_DIR, 'calibri.ttf')
CARLITO_BOLD = os.path.join(FONT_DIR, 'calibri_bold.ttf')

# 
FONT_NAME_MAP = {
    'helv': 'Helvetica',
    'hebo': 'Helvetica-Bold',
    'calibri': 'calibri-regular',  #  Calibri
    'calibri-bold': 'calibri-bold',  #  Calibri Bold
}

# , 
FONT_SIZE_FACTOR = 1.0
DEFAULT_FONT_SIZE = 8.0
_PAGE_FONT_CACHE = set()
_TEXTWRITER_FONT_CACHE = {}


def _page_font_key(page, fontname):
    return (id(page.parent), page.xref, fontname)


def _draw_clear_rect(page, rect):
    page.draw_rect(fitz.Rect(rect), color=(1, 1, 1), fill=(1, 1, 1), width=0)


def _draw_clear_rects(page, rects):
    rects = list(rects)
    if not rects:
        return
    if len(rects) == 1:
        _draw_clear_rect(page, rects[0])
        return

    try:
        shape = page.new_shape()
        for rect in rects:
            shape.draw_rect(fitz.Rect(rect))
        shape.finish(color=(1, 1, 1), fill=(1, 1, 1), width=0)
        shape.commit()
    except Exception:
        for rect in rects:
            _draw_clear_rect(page, rect)


def _get_textwriter_font(fontname):
    if fontname == 'calibri' and os.path.exists(CALIBRI_REGULAR_FONT):
        key = ('file', CALIBRI_REGULAR_FONT)
        if key not in _TEXTWRITER_FONT_CACHE:
            _TEXTWRITER_FONT_CACHE[key] = fitz.Font(fontfile=CALIBRI_REGULAR_FONT)
        return _TEXTWRITER_FONT_CACHE[key]

    if fontname == 'calibri-bold' and os.path.exists(CALIBRI_BOLD_FONT):
        key = ('file', CALIBRI_BOLD_FONT)
        if key not in _TEXTWRITER_FONT_CACHE:
            _TEXTWRITER_FONT_CACHE[key] = fitz.Font(fontfile=CALIBRI_BOLD_FONT)
        return _TEXTWRITER_FONT_CACHE[key]

    builtin = fontname if fontname in {'helv', 'hebo'} else 'helv'
    key = ('builtin', builtin)
    if key not in _TEXTWRITER_FONT_CACHE:
        _TEXTWRITER_FONT_CACHE[key] = fitz.Font(builtin)
    return _TEXTWRITER_FONT_CACHE[key]


def _insert_text_items(page, inserts):
    if not inserts:
        return

    try:
        writer = fitz.TextWriter(page.rect)
        for item in inserts:
            text = str(item.get("text", ""))
            if not text:
                continue
            writer.append(
                fitz.Point(item["x"], item["y"]),
                text,
                font=_get_textwriter_font(item.get("font", "calibri")),
                fontsize=item.get("size", 8.0),
            )
        writer.write_text(page, color=(0, 0, 0))
    except Exception:
        for item in inserts:
            insert_text_with_font(
                page,
                fitz.Point(item["x"], item["y"]),
                item["text"],
                fontname=item.get("font", "calibri"),
                fontsize=item.get("size", 8.0),
                color=(0, 0, 0),
            )


def insert_text_with_font(page, point, text, fontname="helv", fontsize=DEFAULT_FONT_SIZE, color=(0, 0, 0), clip=None):
    """
    ( Calibri )

     DejaVu  Calibri , 

    Args:
        page: PDF
        point: 
        text: 
        fontname: ("helv", "hebo", "calibri", "calibri-bold")
        fontsize: 
        color: 
        clip: , 
    """
    actual_fontname = fontname

    if fontname == 'calibri':
        if os.path.exists(CALIBRI_REGULAR_FONT):
            actual_fontname = "CalibriRegular"
            cache_key = _page_font_key(page, actual_fontname)
            if cache_key not in _PAGE_FONT_CACHE:
                page.insert_font(fontfile=CALIBRI_REGULAR_FONT, fontname=actual_fontname)
                _PAGE_FONT_CACHE.add(cache_key)
        else:
            actual_fontname = "helv"
    elif fontname == 'calibri-bold':
        if os.path.exists(CALIBRI_BOLD_FONT):
            actual_fontname = "CalibriBold"
            cache_key = _page_font_key(page, actual_fontname)
            if cache_key not in _PAGE_FONT_CACHE:
                page.insert_font(fontfile=CALIBRI_BOLD_FONT, fontname=actual_fontname)
                _PAGE_FONT_CACHE.add(cache_key)
        else:
            actual_fontname = "hebo"
    else:
        actual_fontname = FONT_NAME_MAP.get(fontname, fontname)
    
    page.insert_text(point, text, fontname=actual_fontname, fontsize=fontsize, color=color)


def get_field_positions(page):
    """
    

    Returns:
        tuple: (field_positions, is_mpo_template)
            field_positions: list,  [{'cable_label': {'bbox':..., 'origin':..., 'size':...}, ...}, ...]
            is_mpo_template: bool, MPO
    """
    blocks = page.get_text("dict")["blocks"]

    # y
    rows = {}
    for block in blocks:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            y = round(line["bbox"][1], 0)
            if y not in rows:
                rows[y] = []
            for span in line["spans"]:
                text = span["text"].strip()
                if text:
                    rows[y].append({
                        'text': text,
                        'x': span["bbox"][0],
                        'bbox': span["bbox"],
                        'size': span["size"],
                        'origin': span.get("origin", None)  # origin
                    })

    # : Limit
    # Cat5e: Limit x  200
    # MPO: Limit x  96
    is_mpo_template = False
    for y in rows.keys():
        spans = sorted(rows[y], key=lambda s: s['x'])
        for span in spans:
            if 'Limit' in span['text'] or 'GBASE' in span['text']:
                if span['x'] < 150:  # MPOLimitx=96
                    is_mpo_template = True
                break

    # (#)
    # : MPO, Cable Label(#)spans[0], 
    # PDF. 
    # : yspan#, Cable Label xspan. 
    field_positions = []
    for y in sorted(rows.keys()):
        spans = sorted(rows[y], key=lambda s: s['x'])
        
        # MPO: Cable Label(x < 50  text#)
        # span#
        has_cable_label = any(s['x'] < 50 and s['text'].startswith('#') for s in spans)
        has_any_hash = any(s['text'].startswith('#') for s in spans)
        
        # MPO, has_cable_label
        # Cat5e, has_any_hash
        is_data_row = has_cable_label if is_mpo_template else (spans and has_any_hash)
        
        if not is_data_row:
            continue
            
        row_fields = {}

        # 
        for span in spans:
                x = span['x']
                bbox = span['bbox']
                text = span['text']
                origin = span['origin']

                # x
                if is_mpo_template:
                    # MPO
                    if x < 50:
                        row_fields['cable_label'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 50 < x < 170:  # Limitx=96
                        row_fields['limit'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 170 < x < 220:  # Lengthx=196
                        row_fields['length'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 220 < x < 270:  # Marginx=237
                        row_fields['next_margin'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 270 < x < 310 and '-' in text:  # MPO Date x=280.68
                        row_fields['date'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 310 < x < 380:  # MPO Time x=318.01
                        row_fields['time'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                else:
                    # Cat5e
                    if x < 50:
                        row_fields['cable_label'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 190 < x < 210:
                        row_fields['limit'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 290 < x < 310:
                        row_fields['length'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 330 < x < 350:
                        row_fields['next_margin'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif 430 < x < 450:
                        row_fields['date'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    elif x > 460:
                        row_fields['time'] = {'bbox': bbox, 'origin': origin, 'size': span['size']}

        # has beenDateTime
        # MPOCable Label
        if 'date' not in row_fields or 'time' not in row_fields:
            # DateTime
            prev_y = y - 1  # 
            date_field = None
            time_field = None
            if prev_y in rows:
                prev_spans = sorted(rows[prev_y], key=lambda s: s['x'])
                for span in prev_spans:
                    x = span['x']
                    text = span['text']
                    bbox = span['bbox']
                    origin = span['origin']
                    
                    if is_mpo_template:
                        # MPO: Datex=281, Timex=318
                        if 270 < x < 310 and '-' in text:  # Date,  '29-01-2026'
                            date_field = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                        elif x > 310:  # Time,  '01:43:17 PM'
                            time_field = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                    else:
                        # Cat5e
                        if 430 < x < 450 and '-' in text:  # Date
                            date_field = {'bbox': bbox, 'origin': origin, 'size': span['size']}
                        elif x > 460:  # Time
                            time_field = {'bbox': bbox, 'origin': origin, 'size': span['size']}
            
            # Date, row_fields
            if date_field:
                row_fields['date'] = date_field
            # Time, row_fields
            if time_field:
                row_fields['time'] = time_field

        # MPOLimit, 
        if is_mpo_template and 'limit' not in row_fields:
            next_y = y + 1
            if next_y in rows:
                next_spans = sorted(rows[next_y], key=lambda s: s['x'])
                # Limit('GBASE')
                for span in next_spans:
                    if 'GBASE' in span['text']:
                        # Limit, y
                        limit_bbox = fitz.Rect(
                            span['bbox'][0],
                            rows[y][0]['bbox'][1],  # y
                            span['bbox'][2],
                            rows[y][0]['bbox'][3]
                        )
                        limit_origin = (span['origin'][0], rows[y][0]['origin'][1])
                        row_fields['limit'] = {
                            'bbox': limit_bbox,
                            'origin': limit_origin,
                            'size': span['size']
                        }
                        break

        field_positions.append(row_fields)

    return field_positions, is_mpo_template


def clear_row_images(page, start_row, end_row, is_mpo_template=False):
    """
    (CU, )
    
    Args:
        page: PDF
        start_row: (0-based)
        end_row: ()
        is_mpo_template: MPO
    """
    # y()
    if is_mpo_template:
        # MPO: 1y  87
        row_start_y = 87
        row_height = 15
        
        # MPO
        # x=13: "MPO"
        # x=171: (Result)
        image_positions = [
            (13, 12),    # "MPO": x=13, 12
            (171, 12),   # : x=171, 12
        ]
    else:
        # Cat5e: 1y  108
        row_start_y = 108
        row_height = 15
        
        # x()
        image_positions = [
            (13, 12),   # "CU": x=13, 12
            (271, 12),  # : x=271, 12
            (386, 12),  # : x=386, 12
        ]
    
    # , redaction
    for row in range(start_row, end_row):
        y = row_start_y + row * row_height
        for x, width in image_positions:
            # : yy-1, 12
            # y-2redactiony0, 
            rect = fitz.Rect(x - 1, y - 2, x + width + 1, y + 12)
            _draw_clear_rect(page, rect)


def fill_page(page, records, start_idx, page_num, is_last_data_page=False):
    """
    
    
    Args:
        page: PDF
        records: 
        start_idx: 
        page_num: ()
        is_last_data_page: ()
    
    Returns:
        int: 
    """
    #  Limit ()
    # Save all records for later use (in case records is a slice)
    all_records_for_dates = list(records)
    fill_page._limit_rows = []
    
    #  get_field_positions , 
    import re
    contents_before = page.get_contents()
    if contents_before:
        content_xref = contents_before[0]
        doc = page.parent
        stream = doc.xref_stream(content_xref)
        if stream:
            stream_text = stream.decode('latin-1', errors='replace')
            # 
            date_pattern = re.compile(rb'<03[0-9A-Fa-f]{38}>Tj', re.IGNORECASE)
            date_matches = list(re.finditer(date_pattern, stream_text.encode('latin-1')))
            date_count_before = len(date_matches)
            print(f"[DEBUG] fill_page : ={date_count_before}", file=sys.stderr)
    
    field_positions, is_mpo_template = get_field_positions(page)
    print(f"[DEBUG fill_page] get_field_positions {len(field_positions)} ", file=sys.stderr)
    if not field_positions:
        return 0
    
    #  get_field_positions , 
    contents_after = page.get_contents()
    if contents_after:
        content_xref = contents_after[0]
        doc = page.parent
        stream = doc.xref_stream(content_xref)
        if stream:
            stream_text = stream.decode('latin-1', errors='replace')
            # 
            date_pattern = re.compile(rb'<03[0-9A-Fa-f]{38}>Tj', re.IGNORECASE)
            date_matches = list(re.finditer(date_pattern, stream_text.encode('latin-1')))
            date_count_after = len(date_matches)
            print(f"[DEBUG] fill_page get_field_positions: xref={content_xref}, ={date_count_after}", file=sys.stderr)
    
    # : y
    def get_insert_y(field):
        """originy"""
        if field.get('origin'):
            return field['origin'][1]
        # : 8pt, origin.y  bbox[3] - 2.5
        return field['bbox'][3] - 2.5
    
    # redact
    redact_rects = []
    date_rects = []  # Track date rects separately
    inserts = []
    processed = 0
    first_empty_row = -1  # 
    max_records_on_page = len(records) - start_idx  # 
    
    for row_idx, fields in enumerate(field_positions):
        record_idx = start_idx + row_idx
        
        if record_idx >= len(records):
            #  - , limit
            for field_name in ['cable_label', 'limit', 'length', 'next_margin', 'date', 'time']:
                if field_name in fields:
                    redact_rects.append(fitz.Rect(fields[field_name]['bbox']))

            # ()
            clear_row_images(page, row_idx, row_idx + 1, is_mpo_template)

            # 
            if first_empty_row < 0:
                first_empty_row = row_idx
            continue
        
        record = records[record_idx]
        processed += 1  # 
        
        # Cable Label -  CID (has been)
        # :  redaction,  CID has been
        #  redaction, page.clean_contents()  CID 
        # if 'cable_label' in fields:
        #     field = fields['cable_label']
        #     redact_rects.append(fitz.Rect(field['bbox']))

        # Limit -  CID ( Calibri )
        # :  redaction  insert,  apply_redactions() 
        #  replace_limits_in_page_stream  CID 
        # 
        if 'limit' in fields:
            record = records[record_idx] if record_idx < len(records) else None
            if record and record.get('limit'):
                #  Limit 
                if not hasattr(fill_page, '_limit_rows'):
                    fill_page._limit_rows = []
                fill_page._limit_rows.append((row_idx, record.get('limit', '')))

        # Length - MPO, 
        if 'length' in fields:
            field = fields['length']
            # MPO: Length"-", , 
            if is_mpo_template:
                print(f"[INFO] MPO{row_idx+1}: Length(: '-')", file=sys.stderr)
                # redact_rectsinserts, 
            else:
                # Cat5e: Length
                redact_rects.append(fitz.Rect(field['bbox']))
                length = record.get('length', 0)
                if isinstance(length, (int, float)):
                    length_str = str(int(length)) if length == int(length) else f"{length:.1f}"
                else:
                    length_str = str(length)
                inserts.append({
                    'x': field['bbox'][0],
                    'y': get_insert_y(field),
                    'text': length_str,
                    'size': field['size'],
                    'font': 'helv'
                })

        # NEXT Margin - MPO, 
        if 'next_margin' in fields:
            field = fields['next_margin']
            # MPO: Margin"-", , 
            if is_mpo_template:
                print(f"[INFO] MPO{row_idx+1}: Margin(: '-')", file=sys.stderr)
                # redact_rectsinserts, 
            else:
                # Cat5e: Margin
                redact_rects.append(fitz.Rect(field['bbox']))
                margin = record.get('next_margin', 0)
                margin_str = f"{float(margin):.1f}" if isinstance(margin, (int, float)) else str(margin)
                inserts.append({
                    'x': field['bbox'][0],
                    'y': get_insert_y(field),
                    'text': margin_str,
                    'size': field['size'],
                    'font': 'helv'
                })
        
        # Date & Time - CID(Calibri)
        # Add redaction for date field to clear old text before redrawing
        # Track date rects separately so we can skip them if dates are replaced in content stream
        if 'date' in fields and record_idx < len(records):
            field = fields['date']
            date_rects.append(fitz.Rect(field['bbox']))
    
    #  - ()
    page_areas = page.search_for("Page :")
    for area in page_areas:
        # 
        expanded_area = fitz.Rect(area.x0, area.y0, 590, area.y1)
        redact_rects.append(expanded_area)
    
    # 
    if first_empty_row >= 0:
        clear_row_images(page, first_empty_row, len(field_positions), is_mpo_template)
    
    # :  apply_redactions()  CID 
    #  clean_contents()  /TouchUp_TextEdit MP  CID 
    # Cable Label  CID ,  clean_contents() 
    if processed > 0:
        # xref
        contents_before_cid = page.get_contents()
        xref_before = contents_before_cid[0] if contents_before_cid else None
        doc = page.parent
        xref_len = doc.xref_length()
        stream_before = doc.xref_stream(xref_before) if xref_before else None
        stream_len_before = len(stream_before) if stream_before else 0
        print(f"[DEBUG fill_page:{page_num}] CID: xref={xref_before}, xref_length={xref_len}, valid={xref_before < xref_len if xref_before else False}, stream_len={stream_len_before}", file=sys.stderr)
        
        page_records = records[start_idx:start_idx + processed]
        print(f"[DEBUG fill_page:{page_num}] page_records={len(page_records)}, ={page_records[0] if page_records else 'None'}", file=sys.stderr)
        
        #  Cable Label CID ( clean_contents )
        replace_result = replace_cable_labels_in_page_stream(page, page_records, 0)
        print(f"[DEBUG fill_page:{page_num}] Cable Label: {replace_result}", file=sys.stderr)
        if replace_result == 0 and processed > 0:
            # CID, 
            contents = page.get_contents()
            xref = contents[0] if contents else None
            stream = doc.xref_stream(xref) if xref else None
            print(f"[DEBUG fill_page:{page_num}] CID: xref={xref}, stream={len(stream) if stream else 0}", file=sys.stderr)
        
        # Limit (, )
        if hasattr(fill_page, '_limit_rows') and fill_page._limit_rows:
            limit_records = [{'limit': limit} for _, limit in fill_page._limit_rows]
            replace_limits_in_page_stream(page, limit_records, 0, is_mpo_template)
            fill_page._limit_rows = []
        # Times stay in the template's own text streams so the original
        # Calibri positioning and spacing are preserved.
        replace_times_in_page_stream(
            page,
            page_records,
            0,
            std_tj_record_offset=1 if is_mpo_template else 0,
        )
        
        # Dates: Replace BEFORE redaction using Tj format to preserve Calibri font
        # Step 1: Fix C2_2 font's FontFile2 to add missing glyph data (digits 4,5,7,8,9)
        # DISABLED - causes MuPDF rendering errors
        # _fix_missing_glyphs_in_font(page.parent)
        # Step 2: Fix CMap mappings for digits
        _fix_f2_cmap_for_dates(page.parent)
        # Step 3: Replace dates in Tj format
        dates_replaced = replace_dates_in_tj_format(page, page_records, 0)
        if dates_replaced > 0:
            print(f"[DEBUG fill_page:{page_num}] Dates: replaced {dates_replaced} in Tj format (Calibri font preserved)", file=sys.stderr)
        
        # Get date positions BEFORE redaction for later drawing
        # Re-get date positions AFTER redaction to ensure they're up to date
        date_positions = _get_date_positions_before_redaction(page)
        if hasattr(_get_date_positions_before_redaction, '_debug'):
            _get_date_positions_before_redaction._debug = True
        print(f"[DEBUG fill_page:{page_num}] date_positions count: {len(date_positions)}")
    
    # Apply redaction for non-date rects only
    # Skip date rects since dates are replaced directly in content stream
    clear_rects = []
    for rect in redact_rects:
        if rect not in date_rects:
            clear_rects.append(rect)
    
    # Do NOT redact date rects - dates are already replaced in content stream (preserves Calibri font)
    # Skip redaction for dates
    _draw_clear_rects(page, clear_rects)
    
    # Dates are already replaced - no need to redraw
    
    # :  clean_contents(),  ToUnicode 
    #  CID ()
    # page.clean_contents()
    
    # 
    text_inserts = []
    for item in inserts:
        font = item.get('font', 'helv')  # Helvetica
        
        # ()
        col_width = item.get('col_width')
        if col_width and font == 'helv':
            # 
            # 
            import math
            target_width = col_width
            font_obj = fitz.Font(font)
            
            # 
            min_size = 5.0
            max_size = 10.0
            
            for _ in range(20):  # 20
                mid_size = (min_size + max_size) / 2
                width = font_obj.text_length(item['text'], fontsize=mid_size)
                if width < target_width:
                    min_size = mid_size
                else:
                    max_size = mid_size
            
            # 
            adjusted_size = (min_size + max_size) / 2
        else:
            #  Calibri 8pt 
            # Helvetica 7.5pt  Calibri 8pt
            adjusted_size = item['size'] * FONT_SIZE_FACTOR
        
        text_inserts.append({
            "x": item["x"],
            "y": item["y"],
            "text": item["text"],
            "size": adjusted_size,
            "font": font,
        })
    
    #  - 
    #  Page  Calibri 8pt(,  Bold)
    # Carlito  Calibri ,  8.0pt
    text_inserts.append({
        "x": 550,
        "y": 826.6,  # 826.6 = 819.4 + 7.2()
        "text": f"Page : {page_num}",
        "font": "calibri",  # Carlito-Regular
        "size": 8.0,  #  Calibri 8pt
    })
    _insert_text_items(page, text_inserts)
    
    # :  clean_contents(),  ToUnicode 
    # page.clean_contents()
    
    return processed


def detect_template_kind(template_doc):
    """Return 'lc', 'mpo', or 'cat5e' based on stable header positions."""
    if len(template_doc) == 0:
        return 'cat5e'

    page = template_doc[0]
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"].strip()
                if text:
                    spans.append({
                        "text": text,
                        "x": span["bbox"][0],
                        "y": span["bbox"][1],
                    })

    factory_xs = [s["x"] for s in spans if s["text"] == "Factory"]
    has_early_factory = any(250 <= x <= 320 for x in factory_xs)
    if has_early_factory:
        return 'lc'

    has_mpo_limit_data = any("GBASE" in s["text"] and s["x"] < 170 for s in spans)
    if has_mpo_limit_data:
        return 'mpo'

    limit_xs = [s["x"] for s in spans if s["text"] == "Limit"]
    if any(x < 150 for x in limit_xs) and not factory_xs:
        return 'mpo'

    return 'cat5e'


def _iter_page_spans(page):
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"].strip()
                if not text:
                    continue
                spans.append({
                    "text": text,
                    "bbox": span["bbox"],
                    "origin": span.get("origin"),
                    "size": span["size"],
                    "x": span["bbox"][0],
                    "y": span["bbox"][1],
                })
    return spans


def _get_lc_rows(page, max_y=None):
    """Collect LC data rows and their template text positions."""
    spans = _iter_page_spans(page)
    label_spans = [
        span for span in spans
        if span["text"].startswith("#")
        and 15 <= span["x"] <= 60
        and span["bbox"][1] > 100
        and (max_y is None or span["bbox"][1] < max_y)
    ]
    label_spans.sort(key=lambda span: (span["origin"][1] if span.get("origin") else span["bbox"][1]))

    def same_row(span, baseline):
        origin = span.get("origin")
        y = origin[1] if origin else span["bbox"][3]
        return abs(y - baseline) <= 2.2

    rows = []
    for label in label_spans:
        baseline = label["origin"][1] if label.get("origin") else label["bbox"][3]
        row_spans = [span for span in spans if same_row(span, baseline)]

        def find_in_x(min_x, max_x, predicate=None):
            candidates = [
                span for span in row_spans
                if min_x <= span["x"] <= max_x
                and (predicate is None or predicate(span["text"]))
            ]
            if not candidates:
                return None
            candidates.sort(key=lambda span: span["x"])
            return candidates[0]

        row = {
            "baseline": baseline,
            "cable_label": label,
            "limit": find_in_x(80, 155, lambda text: bool(text)),
            "length": find_in_x(175, 215, lambda text: bool(text)),
            "next_margin": find_in_x(220, 260, lambda text: bool(text)),
            "date_time": find_in_x(310, 500, lambda text: "-" in text or "/" in text),
        }
        rows.append(row)

    return rows


def _expanded_rect(bbox, x_pad=1.2, y_pad=1.0):
    rect = fitz.Rect(bbox)
    rect.x0 -= x_pad
    rect.x1 += x_pad
    rect.y0 -= y_pad
    rect.y1 += y_pad
    return rect


def _row_clear_rect(row, right=500):
    baseline = row["baseline"]
    return fitz.Rect(13, baseline - 9.5, right, baseline + 4.5)


def _format_pdf_value(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)):
        if float(value).is_integer():
            return str(int(value))
        return f"{float(value):.1f}".rstrip("0").rstrip(".")
    return str(value)


def _format_lc_label(record):
    label = str(record.get("cable_label") or record.get("cable_number") or "").strip()
    if label and not label.startswith("#"):
        label = f"#{label}"
    return label


def _format_lc_datetime(record):
    date_time = str(record.get("date_time") or "").strip()
    if date_time:
        return date_time

    date_part = str(record.get("date") or "").strip()
    time_part = str(record.get("time") or "").strip()
    return f"{date_part} {time_part}".strip()


def _split_pdf_datetime(record):
    date_time = str(record.get("date_time") or "").strip()
    if date_time:
        parts = date_time.split(" ", 1)
        date_part = parts[0].strip() if parts else ""
        time_part = parts[1].strip() if len(parts) > 1 else ""
        return date_part, time_part

    return (
        str(record.get("date") or "").strip(),
        str(record.get("time") or "").strip(),
    )


def _replace_template_datetimes(page, page_records):
    if not page_records:
        return
    replace_times_in_page_stream(page, page_records, 0, std_tj_record_offset=0)
    _fix_f2_cmap_for_dates(page.parent)
    replace_dates_in_tj_format(page, page_records, 0)


def _field_baseline(field):
    return field["origin"][1] if field and field.get("origin") else field["bbox"][3]


def _field_size(*fields, default=8.0):
    for field in fields:
        if field and field.get("size"):
            return field["size"]
    return default


def _rewrite_lc_datetimes(page, rows, page_records):
    """Clear and redraw LC Date & Time values so stale template text cannot remain."""
    redacts = []
    inserts = []

    for row_idx, record in enumerate(page_records):
        if row_idx >= len(rows):
            break

        field = rows[row_idx].get("date_time")
        if not field:
            continue

        baseline = _field_baseline(field)
        redacts.append(fitz.Rect(field["bbox"][0] - 1.4, field["bbox"][1] - 1.0, 505.0, field["bbox"][3] + 1.0))
        inserts.append({
            "x": field["bbox"][0],
            "y": baseline,
            "text": _format_lc_datetime(record),
            "size": _field_size(field),
            "font": "calibri",
        })

    _apply_redacts_and_inserts(page, redacts, inserts)


def _queue_site_header_update(page, site, redacts, inserts):
    if not site:
        return False

    spans = _iter_page_spans(page)
    anchor_spans = [
        span for span in spans
        if 55 <= span["bbox"][1] <= 72
        and "Site:" in span["text"]
        and span["x"] < 130
    ]
    if not anchor_spans:
        return False

    anchor = min(anchor_spans, key=lambda span: span["bbox"][0])
    anchor_center_y = (anchor["bbox"][1] + anchor["bbox"][3]) / 2
    site_spans = [
        span for span in spans
        if span["bbox"][0] < 210
        and abs(((span["bbox"][1] + span["bbox"][3]) / 2) - anchor_center_y) < 2.5
    ]
    if not site_spans:
        site_spans = anchor_spans

    y0 = max(57.5, min(span["bbox"][1] for span in site_spans) - 0.8)
    y1 = min(73.4, max(span["bbox"][3] for span in site_spans) + 0.4)
    baseline = anchor["origin"][1] if anchor.get("origin") else 70.0
    font_size = anchor.get("size", 8.0)
    redacts.append(fitz.Rect(18.5, y0, 210.0, y1))
    inserts.append({
        "x": 20.0,
        "y": baseline,
        "text": f"Site: {site}",
        "size": font_size,
        "font": "calibri-bold",
    })
    return True


def _draw_site_header(page, site):
    redacts = []
    inserts = []
    if not _queue_site_header_update(page, site, redacts, inserts):
        return False
    _apply_redacts_and_inserts(page, redacts, inserts)
    return True


def _queue_lc_site_update(page, site, redacts, inserts):
    _queue_site_header_update(page, site, redacts, inserts)


def _cover_rect(page, rect):
    page.draw_rect(rect, color=(1, 1, 1), fill=(1, 1, 1), width=0)


def _redraw_outline(page, rect, width=1.0):
    pad = 1.4
    _cover_rect(page, fitz.Rect(rect.x0 - pad, rect.y0 - pad, rect.x1 + pad, rect.y0 + pad))
    _cover_rect(page, fitz.Rect(rect.x0 - pad, rect.y0 - pad, rect.x0 + pad, rect.y1 + pad))
    _cover_rect(page, fitz.Rect(rect.x1 - pad, rect.y0 - pad, rect.x1 + pad, rect.y1 + pad))
    _cover_rect(page, fitz.Rect(rect.x0 - pad, rect.y1 - pad, rect.x1 + pad, rect.y1 + pad))
    page.draw_rect(rect, color=(0, 0, 0), width=width)


def _redraw_lc_data_outline(page, bottom_y=800.7659912109375):
    _redraw_outline(page, fitz.Rect(10.0, 74.0, 575.0, bottom_y), width=1.0)


def _queue_page_number_update(page, page_num, redacts, inserts):
    for span in _iter_page_spans(page):
        if "Page :" not in span["text"]:
            continue
        redacts.append(_expanded_rect(span["bbox"], 1.5, 1.0))
        baseline = span["origin"][1] if span.get("origin") else span["bbox"][3]
        inserts.append({
            "x": span["bbox"][0],
            "y": baseline,
            "text": f"Page : {page_num}",
            "size": span["size"],
            "font": "calibri",
        })
        return


def _apply_redacts_and_inserts(page, redacts, inserts):
    _draw_clear_rects(page, redacts)
    _insert_text_items(page, inserts)


def _fill_lc_data_page(page, page_records, site, page_num):
    rows = _get_lc_rows(page)
    redacts = []
    inserts = []

    _queue_lc_site_update(page, site, redacts, inserts)
    _queue_page_number_update(page, page_num, redacts, inserts)

    for row_idx, row in enumerate(rows):
        if row_idx >= len(page_records):
            redacts.append(_row_clear_rect(row))
            continue

        record = page_records[row_idx]
        values = {
            "cable_label": _format_lc_label(record),
            "limit": str(record.get("limit") or "Link Validation"),
            "length": _format_pdf_value(record.get("length")),
            "next_margin": _format_pdf_value(record.get("next_margin")),
            "date_time": _format_lc_datetime(record),
        }

        for field_name in ["cable_label", "limit", "length", "next_margin", "date_time"]:
            if field_name == "date_time":
                continue
            field = row.get(field_name)
            if not field:
                continue
            redacts.append(_expanded_rect(field["bbox"], 1.2, 1.0))
            baseline = field["origin"][1] if field.get("origin") else field["bbox"][3]
            inserts.append({
                "x": field["bbox"][0],
                "y": baseline,
                "text": values[field_name],
                "size": field["size"],
                "font": "calibri",
            })

    for rect in redacts:
        _cover_rect(page, rect)

    _insert_text_items(page, inserts)
    _replace_template_datetimes(page, page_records)
    _rewrite_lc_datetimes(page, rows, page_records)
    _redraw_lc_data_outline(page)
    return len(page_records)


def _safe_float(value, default=0.0):
    try:
        if value in (None, "", "-"):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _draw_lc_fx_icon(page, x, y):
    page.draw_circle(fitz.Point(x, y), 5.8, color=(0.65, 0.65, 0.65), fill=(1.0, 0.86, 0.0), width=0.8)
    insert_text_with_font(
        page,
        fitz.Point(x - 3.7, y + 2.0),
        "FX",
        fontname="calibri-bold",
        fontsize=5.0,
        color=(0, 0, 0),
    )


def _insert_lc_summary_text(page, x, y, text, bold=True):
    insert_text_with_font(
        page,
        fitz.Point(x, y),
        text,
        fontname="calibri-bold" if bold else "calibri",
        fontsize=8.0,
        color=(0, 0, 0),
    )


def _footer_printed_text():
    now = datetime.now()
    return f"Printed: {now.year}/{now.month}/{now.day} {now.strftime('%H:%M:%S')}"


def _get_footer_logo_rect(footer_template_page):
    for image in footer_template_page.get_images(full=True):
        xref = image[0]
        rects = footer_template_page.get_image_rects(xref)
        footer_rects = [fitz.Rect(rect) for rect in rects if rect.y0 > 730]
        if not footer_rects:
            continue
        footer_rects.sort(key=lambda rect: (rect.y0, rect.x0))
        return footer_rects[0]
    return fitz.Rect(280.5, 819.0, 342.56, 835.0)


def _render_footer_logo_stream(footer_template_page, logo_rect):
    try:
        matrix = fitz.Matrix(16, 16)
        pix = footer_template_page.get_pixmap(matrix=matrix, clip=logo_rect, alpha=True)
        return pix.tobytes("png")
    except Exception:
        return None


def _draw_export_logo(page, logo_rect, logo_stream):
    if logo_stream:
        page.insert_image(logo_rect, stream=logo_stream, keep_proportion=False)


def _draw_final_footer(page, footer_template_page):
    logo_rect = _get_footer_logo_rect(footer_template_page)
    logo_stream = _render_footer_logo_stream(footer_template_page, logo_rect)
    _draw_clear_rect(page, fitz.Rect(0.0, 812.0, 595.0, 842.0))

    insert_text_with_font(
        page,
        fitz.Point(55.0, 825.66),
        _footer_printed_text(),
        fontname="calibri",
        fontsize=7.0,
        color=(0, 0, 0),
    )
    _draw_export_logo(page, logo_rect, logo_stream)
    insert_text_with_font(
        page,
        fitz.Point(464.33, 825.66),
        "Signature:______________________",
        fontname="calibri",
        fontsize=7.0,
        color=(0, 0, 0),
    )


def _draw_lc_summary_boxes(page, top_y, site, pass_count, fail_count, total_length_str):
    first = fitz.Rect(10.0, top_y, 575.0, top_y + 35.0)
    second = fitz.Rect(10.0, top_y + 40.0, 575.0, top_y + 75.0)

    page.draw_rect(first, color=(0, 0, 0), width=1.0)
    page.draw_rect(second, color=(0, 0, 0), width=1.0)

    rows = [
        (top_y, f"Total for Site: {site or ''}"),
        (top_y + 40.0, "Total for Selected Reports"),
    ]

    for box_top, title in rows:
        header_y = box_top + 10.0
        value_y = box_top + 25.0

        _insert_lc_summary_text(page, 13.95, header_y, title)
        _insert_lc_summary_text(page, 214.0, header_y, "Pass")
        _insert_lc_summary_text(page, 334.0, header_y, "Fail")
        _insert_lc_summary_text(page, 464.0, header_y, "Length (m)")

        _draw_lc_fx_icon(page, 29.0, box_top + 22.5)
        _insert_lc_summary_text(page, 39.0, value_y, "Fiber", bold=False)
        _insert_lc_summary_text(page, 214.0, value_y, str(pass_count), bold=False)
        _insert_lc_summary_text(page, 334.0, value_y, str(fail_count), bold=False)
        _insert_lc_summary_text(page, 464.0, value_y, total_length_str, bold=False)


def _row_baseline(fields):
    for field_name in ["cable_label", "limit", "length", "next_margin", "date", "time"]:
        field = fields.get(field_name)
        if not field:
            continue
        origin = field.get("origin")
        if origin:
            return origin[1]
        return field["bbox"][3]
    return None


def _get_data_outline_rect(page, default_bottom=800.7659912109375):
    candidates = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        if not rect:
            continue
        if rect.width > 500 and rect.height > 250 and 8 <= rect.x0 <= 12 and 570 <= rect.x1 <= 578:
            candidates.append(rect)
    if candidates:
        candidates.sort(key=lambda rect: rect.height, reverse=True)
        return fitz.Rect(candidates[0])
    return fitz.Rect(10.0, 74.0, 575.0, default_bottom)


def _row_bottom_padding(fields, table_rect):
    baselines = [baseline for baseline in (_row_baseline(row) for row in fields) if baseline is not None]
    if not baselines:
        return 9.0
    return max(7.0, min(11.0, table_rect.y1 - baselines[-1]))


def _summary_rows_capacity(fields, table_rect):
    row_bottom_pad = _row_bottom_padding(fields, table_rect)
    # Two 35 pt summary boxes with a 5 pt gap and 5 pt gap after the table.
    required_summary_height = 80.0
    capacity = 0
    for idx, fields_for_row in enumerate(fields):
        baseline = _row_baseline(fields_for_row)
        if baseline is None:
            continue
        data_bottom = baseline + row_bottom_pad
        if data_bottom + required_summary_height <= table_rect.y1 + 0.5:
            capacity = idx + 1
    return capacity


def _final_data_bottom_y(fields, filled_count, table_rect):
    row_bottom_pad = _row_bottom_padding(fields, table_rect)
    if filled_count > 0 and filled_count <= len(fields):
        baseline = _row_baseline(fields[filled_count - 1])
        if baseline is not None:
            return baseline + row_bottom_pad

    baselines = [baseline for baseline in (_row_baseline(row) for row in fields) if baseline is not None]
    if baselines:
        return max(table_rect.y0 + 12.0, baselines[0] - 5.0)
    return table_rect.y0 + 24.0


def _draw_media_icon(page, x, y, label, fill_color):
    page.draw_circle(fitz.Point(x, y), 5.8, color=(0.62, 0.62, 0.62), fill=fill_color, width=0.8)
    font_size = 3.6 if len(label) > 2 else 5.0
    text_x = x - (4.6 if len(label) > 2 else 3.2)
    insert_text_with_font(
        page,
        fitz.Point(text_x, y + 1.8),
        label,
        fontname="calibri-bold",
        fontsize=font_size,
        color=(1, 1, 1),
    )


def _insert_summary_text(page, x, y, text, bold=True, size=8.0):
    insert_text_with_font(
        page,
        fitz.Point(x, y),
        text,
        fontname="calibri-bold" if bold else "calibri",
        fontsize=size,
        color=(0, 0, 0),
    )


def _draw_non_lc_summary_boxes(page, top_y, site, pass_count, fail_count, total_length_str, is_mpo_template):
    first = fitz.Rect(10.0, top_y, 575.0, top_y + 35.0)
    second = fitz.Rect(10.0, top_y + 40.0, 575.0, top_y + 75.0)

    page.draw_rect(first, color=(0, 0, 0), width=1.0)
    page.draw_rect(second, color=(0, 0, 0), width=1.0)

    media_name = "MPO" if is_mpo_template else "Copper"
    icon_text = "MPO" if is_mpo_template else "CU"
    icon_fill = (0.22, 0.55, 0.80) if is_mpo_template else (0.50, 0.34, 0.18)

    rows = [
        (top_y, f"Total for Site: {site or ''}"),
        (top_y + 40.0, "Total for Selected Reports"),
    ]

    for box_top, title in rows:
        header_y = box_top + 10.0
        value_y = box_top + 25.0

        _insert_summary_text(page, 13.95, header_y, title)
        _insert_summary_text(page, 214.0, header_y, "Pass")
        _insert_summary_text(page, 334.0, header_y, "Fail")
        _insert_summary_text(page, 464.0, header_y, "Length (m)")

        _draw_media_icon(page, 29.0, box_top + 22.5, icon_text, icon_fill)
        _insert_summary_text(page, 39.0, value_y, media_name, bold=False)
        _insert_summary_text(page, 214.0, value_y, str(pass_count), bold=False)
        _insert_summary_text(page, 334.0, value_y, str(fail_count), bold=False)
        _insert_summary_text(page, 464.0, value_y, total_length_str, bold=False)


def _non_lc_summary_totals(records, is_mpo_template):
    fail_count = sum(1 for record in records if str(record.get("result", "")).strip().upper() == "FAIL")
    pass_count = len(records) - fail_count
    total_length = 0.0 if is_mpo_template else sum(_safe_float(record.get("length")) for record in records)
    return pass_count, fail_count, _format_pdf_value(total_length)


def _clear_summary_body(page):
    _draw_clear_rect(page, fitz.Rect(8.5, 45.0, 576.5, 805.0))


def _finish_empty_non_lc_summary_page(page, site, records, is_mpo_template):
    _clear_summary_body(page)
    pass_count, fail_count, total_length_str = _non_lc_summary_totals(records, is_mpo_template)
    _draw_non_lc_summary_boxes(page, 55.0, site, pass_count, fail_count, total_length_str, is_mpo_template)


def _finish_non_lc_summary_page(page, fields, filled_count, site, records, is_mpo_template):
    table_rect = _get_data_outline_rect(page, default_bottom=810.0 if is_mpo_template else 800.7659912109375)
    data_bottom_y = _final_data_bottom_y(fields, filled_count, table_rect)
    summary_top_y = data_bottom_y + 5.0

    clear_rect = fitz.Rect(table_rect.x0 - 1.5, data_bottom_y - 0.4, table_rect.x1 + 1.5, table_rect.y1 + 1.5)
    _draw_clear_rect(page, clear_rect)

    _redraw_outline(page, fitz.Rect(table_rect.x0, table_rect.y0, table_rect.x1, data_bottom_y), width=1.0)

    pass_count, fail_count, total_length_str = _non_lc_summary_totals(records, is_mpo_template)
    _draw_non_lc_summary_boxes(page, summary_top_y, site, pass_count, fail_count, total_length_str, is_mpo_template)


def _rewrite_non_lc_datetimes(page, fields, page_records, is_mpo_template=False):
    """Rewrite visible Date & Time text and remove any stale template fragments."""
    redacts = []
    inserts = []

    for row_idx, record in enumerate(page_records):
        if row_idx >= len(fields):
            break

        row = fields[row_idx]
        date_field = row.get("date")
        time_field = row.get("time")
        if not date_field and not time_field:
            continue

        date_part, time_part = _split_pdf_datetime(record)
        row_fields = [item for item in [date_field, time_field] if item]
        y0 = min(item["bbox"][1] for item in row_fields)
        y1 = max(item["bbox"][3] for item in row_fields)
        baseline = (
            (date_field.get("origin")[1] if date_field and date_field.get("origin") else None)
            or (time_field.get("origin")[1] if time_field and time_field.get("origin") else None)
            or y1
        )

        if is_mpo_template:
            clear_x0, clear_x1 = 274.0, 430.0
            fallback_date_x = 280.6
        else:
            clear_x0, clear_x1 = 425.0, 586.0
            fallback_date_x = 430.0

        redacts.append(fitz.Rect(clear_x0, y0 - 1.1, clear_x1, y1 + 1.1))

        datetime_text = f"{date_part} {time_part}".strip()
        if datetime_text:
            inserts.append({
                "x": date_field["bbox"][0] if date_field else fallback_date_x,
                "y": baseline,
                "text": datetime_text,
                "size": _field_size(date_field, time_field),
                "font": "calibri",
            })
    _apply_redacts_and_inserts(page, redacts, inserts)


def _rewrite_non_lc_cable_labels(page, fields, page_records, is_mpo_template=False):
    """Rewrite Cable Label values as real text instead of limited CID digits."""
    redacts = []
    inserts = []
    clear_x1 = 92.0 if is_mpo_template else 190.0

    for row_idx, record in enumerate(page_records):
        if row_idx >= len(fields):
            break

        field = fields[row_idx].get("cable_label")
        if not field:
            continue

        label = str(record.get("cable_label") or record.get("cable_number") or "").strip()
        if not label:
            continue

        bbox = fitz.Rect(field["bbox"])
        redacts.append(fitz.Rect(max(0.0, bbox.x0 - 1.4), bbox.y0 - 1.0, clear_x1, bbox.y1 + 1.0))
        inserts.append({
            "x": bbox.x0,
            "y": _field_baseline(field),
            "text": label,
            "size": _field_size(field),
            "font": "calibri",
        })

    _apply_redacts_and_inserts(page, redacts, inserts)


def edit_non_lc_pdf(input_path, output_path, records, site=None, template_kind='cat5e'):
    """Fill MPO/Cat5e templates and place totals under the final data row."""
    try:
        template_doc = fitz.open(input_path)
        doc = fitz.open()
        is_mpo_template = template_kind == 'mpo'

        data_template_page = DATA_TEMPLATE_PAGE if len(template_doc) > DATA_TEMPLATE_PAGE + 1 else 0
        template_fields, _ = get_field_positions(template_doc[data_template_page])
        if not template_fields:
            template_fields, _ = get_field_positions(template_doc[0])
            data_template_page = 0

        rows_per_page = max(1, len(template_fields))
        table_rect = _get_data_outline_rect(template_doc[data_template_page], default_bottom=810.0 if is_mpo_template else 800.7659912109375)
        summary_rows = _summary_rows_capacity(template_fields, table_rect)
        summary_rows = max(0, min(summary_rows, rows_per_page))

        total_records = len(records)
        data_pages_needed = max(0, (max(0, total_records - summary_rows) + rows_per_page - 1) // rows_per_page)
        summary_start_idx = min(total_records, data_pages_needed * rows_per_page)

        print(f"[INFO] : {'MPO' if is_mpo_template else 'Cat5e'}", file=sys.stderr)
        print(f"[INFO] rows/page: {rows_per_page}", file=sys.stderr)
        print(f"[INFO] summary rows/page: {summary_rows}", file=sys.stderr)
        print(f"[INFO] data pages before summary: {data_pages_needed}", file=sys.stderr)

        for page_idx in range(data_pages_needed):
            source_page = 0 if page_idx == 0 else data_template_page
            doc.insert_pdf(template_doc, from_page=source_page, to_page=source_page)
            page = doc[-1]
            start = page_idx * rows_per_page
            fields_for_page, _ = get_field_positions(page)
            processed = fill_page(page, records, start, page_idx + 1)
            page_records = records[start:start + processed]
            _rewrite_non_lc_cable_labels(page, fields_for_page, page_records, is_mpo_template)
            _rewrite_non_lc_datetimes(page, fields_for_page, page_records, is_mpo_template)
            _redraw_outline(page, _get_data_outline_rect(page, default_bottom=810.0 if is_mpo_template else 800.7659912109375), width=1.0)
            if page_idx == 0 and site:
                _draw_site_header(page, site)

        summary_record_count = total_records - summary_start_idx
        final_source_page = (
            len(template_doc) - 1
            if summary_record_count == 0
            else (0 if data_pages_needed == 0 else data_template_page)
        )
        doc.insert_pdf(template_doc, from_page=final_source_page, to_page=final_source_page)
        summary_page = doc[-1]
        summary_page_num = data_pages_needed + 1
        if summary_record_count == 0:
            _finish_empty_non_lc_summary_page(summary_page, site, records, is_mpo_template)
        else:
            fields_for_summary, _ = get_field_positions(summary_page)
            processed = fill_page(summary_page, records, summary_start_idx, summary_page_num)
            summary_page_records = records[summary_start_idx:summary_start_idx + processed]
            _rewrite_non_lc_cable_labels(summary_page, fields_for_summary, summary_page_records, is_mpo_template)
            _rewrite_non_lc_datetimes(summary_page, fields_for_summary, summary_page_records, is_mpo_template)
            if data_pages_needed == 0 and site:
                _draw_site_header(summary_page, site)
            _finish_non_lc_summary_page(summary_page, fields_for_summary, processed, site, records, is_mpo_template)
        _draw_final_footer(summary_page, template_doc[-1])

        doc.save(output_path, garbage=4, deflate=True, encryption=fitz.PDF_ENCRYPT_NONE)
        doc.close()
        template_doc.close()

        return {
            'success': True,
            'method': 'table_summary_fill',
            'records_processed': total_records,
            'pages_used': data_pages_needed + 1,
            'output_path': output_path
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {'error': str(e)}


def _fill_lc_summary_page(page, page_records, all_records, site, page_num):
    redacts = []
    inserts = []
    rows = _get_lc_rows(page, max_y=440)

    fail_count = sum(1 for record in all_records if str(record.get("result", "")).strip().upper() == "FAIL")
    pass_count = len(all_records) - fail_count
    total_length = sum(_safe_float(record.get("length")) for record in all_records)
    total_length_str = _format_pdf_value(total_length)

    if not page_records:
        _clear_summary_body(page)
        _draw_lc_summary_boxes(page, 55.0, site, pass_count, fail_count, total_length_str)
        _draw_final_footer(page, page)
        return

    for row_idx, row in enumerate(rows):
        if row_idx >= len(page_records):
            redacts.append(_row_clear_rect(row))
            continue

        record = page_records[row_idx]
        values = {
            "cable_label": _format_lc_label(record),
            "limit": str(record.get("limit") or "Link Validation"),
            "length": _format_pdf_value(record.get("length")),
            "next_margin": _format_pdf_value(record.get("next_margin")),
            "date_time": _format_lc_datetime(record),
        }

        for field_name in ["cable_label", "limit", "length", "next_margin", "date_time"]:
            if field_name == "date_time":
                continue
            field = row.get(field_name)
            if not field:
                continue
            redacts.append(_expanded_rect(field["bbox"], 1.2, 1.0))
            baseline = field["origin"][1] if field.get("origin") else field["bbox"][3]
            inserts.append({
                "x": field["bbox"][0],
                "y": baseline,
                "text": values[field_name],
                "size": field["size"],
                "font": "calibri",
            })

    if page_records:
        last_row = rows[len(page_records) - 1]
        data_bottom_y = last_row["baseline"] + 8.53
    else:
        data_bottom_y = 110.0

    first_summary_top = data_bottom_y + 6.23

    # Remove the unused lower part of the original data rectangle and the old
    # fixed-position summary boxes. They will be redrawn immediately below the
    # final populated row.
    redacts.append(fitz.Rect(8.5, data_bottom_y - 0.4, 576.5, 523.5))

    spans = _iter_page_spans(page)
    for span in spans:
        text = span["text"]
        baseline = span["origin"][1] if span.get("origin") else span["bbox"][3]

        if text.startswith("Printed:"):
            printed_text = f"Printed: {datetime.now().strftime('%Y/%m/%d %H:%M:%S')}"
            redacts.append(_expanded_rect(span["bbox"], 2.0, 1.0))
            inserts.append({
                "x": span["bbox"][0],
                "y": baseline,
                "text": printed_text,
                "size": span["size"],
                "font": "calibri-bold",
            })

    _apply_redacts_and_inserts(page, redacts, inserts)
    _replace_template_datetimes(page, page_records)
    _rewrite_lc_datetimes(page, rows, page_records)
    _redraw_lc_data_outline(page, data_bottom_y)
    _draw_lc_summary_boxes(page, first_summary_top, site, pass_count, fail_count, total_length_str)
    _draw_final_footer(page, page)


def edit_lc_pdf(input_path, output_path, records, site=None):
    """Fill the LC template without using MPO/Cat5e column assumptions."""
    try:
        template_doc = fitz.open(input_path)
        _fix_lc_template_date(template_doc)
        doc = fitz.open()

        rows_per_page = len(_get_lc_rows(template_doc[0]))
        rows_per_page = max(rows_per_page, 1)
        summary_rows = len(_get_lc_rows(template_doc[-1], max_y=440))
        summary_rows = max(summary_rows, 1)
        total_records = len(records)
        template_data_pages = max(1, len(template_doc) - 1)
        data_pages_needed = max(0, (max(0, total_records - summary_rows) + rows_per_page - 1) // rows_per_page)
        summary_start_idx = min(total_records, data_pages_needed * rows_per_page)
        summary_records = records[summary_start_idx:]

        print(f"[INFO] : LC", file=sys.stderr)
        print(f"[INFO] LC rows/page: {rows_per_page}", file=sys.stderr)
        print(f"[INFO] LC summary rows/page: {summary_rows}", file=sys.stderr)
        print(f"[INFO] LC data pages needed before summary: {data_pages_needed}", file=sys.stderr)

        for page_idx in range(data_pages_needed):
            source_page = min(page_idx, template_data_pages - 1)
            doc.insert_pdf(template_doc, from_page=source_page, to_page=source_page)
            page = doc[-1]
            start = page_idx * rows_per_page
            page_records = records[start:start + rows_per_page]
            _fill_lc_data_page(page, page_records, site, page_idx + 1)

        doc.insert_pdf(template_doc, from_page=len(template_doc) - 1, to_page=len(template_doc) - 1)
        _fill_lc_summary_page(doc[-1], summary_records, records, site, data_pages_needed + 1)

        doc.save(output_path, garbage=4, deflate=True, encryption=fitz.PDF_ENCRYPT_NONE)
        doc.close()
        template_doc.close()

        return {
            'success': True,
            'method': 'lc_template_fill',
            'records_processed': total_records,
            'pages_used': data_pages_needed + 1,
            'output_path': output_path
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {'error': str(e)}


def edit_pdf(input_path, output_path, records, site=None):
    """Edit PDF template with test records.

    Args:
        input_path: Input PDF path.
        output_path: Output PDF path.
        records: List of test records.
        site: Site identifier.

    Returns:
        dict: Result dictionary.
    """
    try:
        template_doc = fitz.open(input_path)
        template_kind = detect_template_kind(template_doc)
        if template_kind == 'lc':
            template_doc.close()
            return edit_lc_pdf(input_path, output_path, records, site)
        if template_kind in ('mpo', 'cat5e'):
            template_doc.close()
            return edit_non_lc_pdf(input_path, output_path, records, site, template_kind)

        doc = fitz.open()
        is_mpo_template = template_kind == 'mpo'

        print(f"[INFO] : {'MPO' if is_mpo_template else 'Cat5e'}", file=sys.stderr)

        # 
        # MPO, 
        # Detect template_data_pages BEFORE inserting template_doc to avoid cache issues
        import re
        template_data_pages = 0
        for i in range(len(template_doc) - 1):  # Exclude summary page
            page = template_doc[i]
            contents = page.get_contents()
            has_data_rows = False
            for xref in contents:
                stream = template_doc.xref_stream(xref)
                if stream:
                    text = stream.decode('latin-1', errors='replace')
                    # Check for Cable Label patterns in stream
                    if re.search(r'\(#[0-9]{3,}\)', text):  # e.g., (#1122)
                        has_data_rows = True
                        break
            if has_data_rows:
                template_data_pages = i + 1  # (0, +1)
                print(f"[DEBUG] {i} (template_data_pages={template_data_pages})", file=sys.stderr)

        # Fix corrupted date Tj in template_doc page 1 (if LC template)
        # Page 1 of LC template has corrupted date Tj (37 chars) instead of correct 45 chars
        # This is a template issue that needs to be fixed before inserting
        _fix_lc_template_date(template_doc)

        # 
        doc.insert_pdf(template_doc)
        # template_doc, 

        total_records = len(records)
        record_idx = 0
        page_num = 0

        # ()
        summary_page_idx = len(doc) - 1

        print(f"[INFO] PDF,  {total_records} ", file=sys.stderr)
        print(f"[INFO]  {ROWS_PER_PAGE} ", file=sys.stderr)
        print(f"[INFO] : {template_data_pages}", file=sys.stderr)
        print(f"[INFO] : {summary_page_idx}", file=sys.stderr)

        # 
        total_pages_needed = max(
            (total_records + ROWS_PER_PAGE - 1) // ROWS_PER_PAGE,
            template_data_pages  # 
        )

        print(f"[INFO] : {total_pages_needed}", file=sys.stderr)

        # : 
        print(f"[DEBUG] : page_num={page_num}, record_idx={record_idx}, total_records={total_records}", file=sys.stderr)

        # Site: 
        # - template_data_pages > 0, 1(doc[0])Site, while
        # - template_data_pages = 0, 1insert_pdf, Site
        
        # Site1(template_data_pages=0)
        first_page_site_info = None
        if template_data_pages == 0 and site:
            # 0Site
            template_first_page = template_doc[0]
            blocks = template_first_page.get_text("dict")["blocks"]
            for block in blocks:
                if "lines" not in block:
                    continue
                for line in block["lines"]:
                    y = line["bbox"][1]
                    if 58 < y < 75:
                        for span in line["spans"]:
                            if 'Site:' in span["text"]:
                                first_page_site_info = {
                                    'origin': span.get("origin"),
                                    'bbox': span["bbox"]
                                }
                                print(f"[INFO] 1Site", file=sys.stderr)
                                break
                        if first_page_site_info:
                            break

        # 
        # : record_idx < total_records 
        while page_num < total_pages_needed:
            # : 
            print(f"[DEBUG LOOP] {page_num}: record_idx={record_idx}, processed={record_idx}", file=sys.stderr)
            
            # 
            has_records = record_idx < total_records
            
            # file or JSON 
            if not has_records:
                # 
                page = doc[page_num]
                blocks = page.get_text("dict")["blocks"]
                rows = {}
                for block in blocks:
                    if "lines" not in block:
                        continue
                    for line in block["lines"]:
                        y = round(line["bbox"][1], 0)
                        if y not in rows:
                            rows[y] = []
                        for span in line["spans"]:
                            text = span["text"].strip()
                            if text:
                                rows[y].append({
                                    'text': text,
                                    'x': span["bbox"][0],
                                    'bbox': span["bbox"],
                                    'size': span["size"],
                                    'origin': span.get("origin", None)
                                })
                
                # 
                redact_rects = []
                for y in sorted(rows.keys()):
                    spans = sorted(rows[y], key=lambda s: s['x'])
                    # Find Cable Label span (x < 90)
                    cable_label_span = None
                    for span in spans:
                        if span['x'] < 90 and span['text'].startswith('#'):
                            cable_label_span = span
                            break
                    
                    # Only clear rows that have placeholder Cable Label (not replaced by fill_page)
                    # Placeholder is "#Cable Label", replaced value is like "#354"
                    if cable_label_span:
                        text = cable_label_span['text']
                        # Check if this is a placeholder (starts with "#Cable")
                        is_placeholder = text.startswith('#Cable') or text == '#'
                        # Only redact placeholder rows
                        if is_placeholder:
                            redact_rects.append(fitz.Rect(cable_label_span['bbox']))
                
                # 
                if redact_rects:
                    for rect in redact_rects:
                        page.add_redact_annot(rect, fill=(1, 1, 1))
                    page.apply_redactions()
                
                page_num += 1
                continue
            
            # ()
            is_new_page = False
            if page_num >= template_data_pages:
                # 2(1)
                # 
                # : , 
                insert_position = page_num  # page_num
                
                
                doc.insert_pdf(template_doc, from_page=DATA_TEMPLATE_PAGE, to_page=DATA_TEMPLATE_PAGE, start_at=insert_position)
                
                # : 
                print(f"[DEBUG LOOP] : page_num={page_num}, doc.page_count={doc.page_count}", file=sys.stderr)
                contents_after = doc[page_num].get_contents()

            page = doc[page_num]

            #  fill_page ,  Cable Label CID 
            #  fill_page  apply_redactions()  CID 
            page_records_start = record_idx
            page_records = records[page_records_start:page_records_start + ROWS_PER_PAGE]
            if page_records:
                print(f"[DEBUG edit_pdf] {page_num}: page_records={len(page_records)}, record_idx={record_idx}", file=sys.stderr)
                print(f"[DEBUG edit_pdf] {page_num}: records[0]={records[0] if records else 'None'}", file=sys.stderr)
                print(f"[DEBUG edit_pdf] {page_num}: page_records[0]={page_records[0]}", file=sys.stderr)

            #  fill_page 
            # :  page_records_start
            page_records_start = record_idx
            processed = fill_page(page, records, page_records_start, page_num + 1)
            
            # : fill_pageprocessed
            print(f"[DEBUG LOOP] fill_page: processed={processed}, record_idx={record_idx + processed}", file=sys.stderr)
            
            # ( CID )
            # fill_page  apply_redactions()  CID , 
            # REMOVED: Duplicate call to _draw_dates_at_positions
            # fill_page  _draw_dates_at_positions
            # if records:
            #     # Get date positions after redaction
            #     date_positions = _get_date_positions_after_redaction(page)
            #     if date_positions:
            #         # Use page_records_start as start_idx to get correct records
            #         _draw_dates_at_positions(page, records, date_positions, page_records_start)
            
            
            # Site()- CID
            if page_num == 0 and site:
                site_replaced = _draw_site_header(page, site)
                
                if not site_replaced:
                    print(f"[WARN] Site", file=sys.stderr)
            
            # ()
            # :  fill_page 1359,  Length  Margin
            #  fill_page
            
            record_idx += processed
            
            # records
            page_start_idx = record_idx - processed
            
            # : replace_cable_labels_in_page_stream has been fill_page 
            # file or JSON  clean_contents() 
            
            page_num += 1
        
        # ()
        # 
        min_data_pages = max(1, (total_records + ROWS_PER_PAGE - 1) // ROWS_PER_PAGE)
        current_data_pages = summary_page_idx  # 
        pages_to_delete = current_data_pages - min_data_pages
        
        # ()
        for i in range(pages_to_delete):
            # ( doc.page_count - 2, )
            doc.delete_page(doc.page_count - 2)
            summary_page_idx -= 1
            print(f"[INFO] ,  {doc.page_count} ", file=sys.stderr)
        
        # 
        # After inserting data pages, the summary page is now the last page
        summary_page_idx = len(doc) - 1
        summary_page = doc[summary_page_idx]

        # PassLength
        pass_count = len(records)

        # MPOLength"-", Length, 0
        if is_mpo_template:
            total_length = 0
        else:
            # length
            def safe_float(val, default=0):
                try:
                    return float(val) if val not in (None, '', '-') else default
                except (ValueError, TypeError):
                    return default
            total_length = sum(safe_float(r.get('length', 0)) for r in records)

        total_length_str = str(int(total_length)) if total_length == int(total_length) else f"{total_length:.1f}"
        
        # 
        # Passx=214, Lengthx=464
        # : y=72.4(Total for Site)y=112.4(Total for Selected Reports)
        summary_redacts = []
        summary_inserts = []
        
        blocks = summary_page.get_text("dict")["blocks"]
        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    x = span["bbox"][0]
                    text = span["text"].strip()
                    origin = span.get("origin")
                    
                    # Pass (x214)
                    if 210 < x < 220 and text.isdigit():
                        summary_redacts.append(fitz.Rect(span["bbox"]))
                        summary_inserts.append({
                            'x': x,
                            'y': origin[1] if origin else span["bbox"][3] - 2.5,
                            'text': str(pass_count)
                        })
                    
                    # Length (x464)
                    if 460 < x < 470 and (text.replace('.', '').isdigit()):
                        summary_redacts.append(fitz.Rect(span["bbox"]))
                        summary_inserts.append({
                            'x': x,
                            'y': origin[1] if origin else span["bbox"][3] - 2.5,
                            'text': total_length_str
                        })
        
        # Replace dates on summary page BEFORE redaction
        # This is needed because the summary page dates use C2_2 font with specific CID encoding
        if records:
            # Support both 'date_time' and 'date' + 'time' fields
            first_record_date = ''
            if records:
                record = records[0]
                date_time = record.get('date_time', '')
                if date_time:
                    first_record_date = date_time.split(' ')[0]
                else:
                    first_record_date = record.get('date', '')
            if first_record_date:
                # Get page xref and object
                page_xref = summary_page.xref
                page_obj = doc.xref_object(page_xref)
                
                # Find C2_2 font reference (summary page dates use C2_2)
                c2_2_match = re.search(r'/C2_2\s+(\d+)\s+0\s+R', page_obj)
                if c2_2_match:
                    c2_2_xref = int(c2_2_match.group(1))
                    font_obj = doc.xref_object(c2_2_xref)
                    
                    # Get ToUnicode stream and add missing mappings
                    tu_match = re.search(r'/ToUnicode\s+(\d+)\s+0\s+R', font_obj)
                    if tu_match:
                        tu_xref = int(tu_match.group(1))
                        tu_stream = doc.xref_stream(tu_xref)
                        if tu_stream:
                            tu_text = tu_stream.decode('latin-1', errors='replace')
                            
                            # Add mappings for digits 4, 5, 7, 8, 9
                            new_mappings = [
                                ('03F0', '0034'),  # 4
                                ('03F1', '0035'),  # 5
                                ('03F3', '0037'),  # 7
                                ('03F4', '0038'),  # 8
                                ('03F5', '0039'),  # 9
                            ]
                            
                            insert_pos = tu_text.rfind('endbfchar')
                            if insert_pos >= 0:
                                new_cmap = tu_text[:insert_pos]
                                for cid, unicode_val in new_mappings:
                                    if f'<{cid}>' not in tu_text:
                                        new_cmap += f'<{cid}> <{unicode_val}>\n'
                                new_cmap += tu_text[insert_pos:]
                                doc.update_stream(tu_xref, new_cmap.encode('latin-1'))
                
                # Build CID map for digits and hyphen
                cid_map = {
                    '0': '03EC', '1': '03ED', '2': '03EE', '3': '03EF',
                    '4': '03F0', '5': '03F1', '6': '03F2', '7': '03F3',
                    '8': '03F4', '9': '03F5', '-': '0372'
                }
                
                # Build new date hex
                date_chars = list(first_record_date)
                new_date_hex = ''.join(cid_map.get(c, '03EC') for c in date_chars if c in cid_map)
                new_date_hex_wrapped = f'<{new_date_hex}>'
                
                # Old date "23-01-2026" hex in C2_2: <03EE03EF037203EC03ED037203EE03EC03EE03F2>
                old_date_hex = '<03EE03EF037203EC03ED037203EE03EC03EE03F2>'
                
                # Replace dates in content streams BEFORE redaction
                contents = summary_page.get_contents()
                replaced_count = 0
                for xref in contents:
                    stream = doc.xref_stream(xref)
                    if stream:
                        stream_text = stream.decode('latin-1', errors='replace')
                        if old_date_hex in stream_text:
                            new_stream_text = stream_text.replace(old_date_hex, new_date_hex_wrapped)
                            doc.update_stream(xref, new_stream_text.encode('latin-1'))
                            replaced_count += 1
                
                print(f"[INFO] LC Summary page: replaced {replaced_count} date(s) with {first_record_date}", file=sys.stderr)
        
        # Apply redactions for Pass and Length fields
        for rect in summary_redacts:
            summary_page.add_redact_annot(rect, fill=(1, 1, 1))
        summary_page.apply_redactions()
        
        for item in summary_inserts:
            # DejaVu SansCalibri, 
            adjusted_size = 6.0 if is_mpo_template else 8
            insert_text_with_font(
                summary_page,
                fitz.Point(item['x'], item['y']),
                item['text'],
                fontname="hebo",
                fontsize=adjusted_size,
                color=(0, 0, 0)
            )
        
        # Printed
        current_time = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        printed_text = f"Printed: {current_time}"
        
        # Printed
        printed_updated = False
        blocks = summary_page.get_text("dict")["blocks"]
        for block in blocks:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    text = span["text"].strip()
                    if 'Printed' in text:
                        bbox = span["bbox"]
                        origin = span.get("origin")
                        
                        # 
                        summary_page.add_redact_annot(fitz.Rect(bbox), fill=(1, 1, 1))
                        summary_page.apply_redactions()
                        
                        # 
                        insert_y = origin[1] if origin else bbox[3] - 2
                        # DejaVu SansCalibri, 
                        adjusted_size = 5.5 if is_mpo_template else 7
                        insert_text_with_font(
                            summary_page,
                            fitz.Point(55.0, insert_y),
                            printed_text,
                            fontname="hebo",
                            fontsize=adjusted_size,
                            color=(0, 0, 0)
                        )
                        printed_updated = True
                        print(f"[INFO] Printed: {printed_text}", file=sys.stderr)
                        break
                if printed_updated:
                    break
            if printed_updated:
                break
        
        # , 
        
        # :  clean_contents(),  ToUnicode 
        # summary_page.clean_contents()

        print(f"[INFO] : Pass={pass_count}, Length={total_length_str}", file=sys.stderr)
        print(f"[INFO] : Page : {page_num + 1}", file=sys.stderr)

        # ()
        total_pages = len(doc)
        expected_pages = total_pages_needed + 1  #  + 
        if total_pages > expected_pages:
            print(f"[INFO] : {total_pages - expected_pages}", file=sys.stderr)
            for i in range(total_pages - expected_pages):
                doc.delete_page(total_pages_needed)  # (total_pages_needed)
        
        # , 
        # summary_page_idx 
        correct_page_num = summary_page_idx + 1  # 1-based 
        
        print(f"[INFO] : Pass={pass_count}, Length={total_length_str}", file=sys.stderr)
        print(f"[INFO] : Page : {correct_page_num}", file=sys.stderr)
        
        #  PDF - 
        # , 
        try:
            doc.save(output_path, incremental=True, encryption=fitz.PDF_ENCRYPT_NONE)
        except ValueError:
            # 
            doc.save(output_path, encryption=fitz.PDF_ENCRYPT_NONE)
        doc.close()
        template_doc.close()
        
        return {
            'success': True,
            'method': 'column_replace',
            'records_processed': total_records,
            'pages_used': page_num,
            'output_path': output_path
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {'error': str(e)}


def modify_pdf_precise(input_path: str, output_path: str, modifications: dict) -> dict:
    """Precise PDF modification."""
    records = modifications.get('records', [])
    site = modifications.get('site', None)
    
    print(f"[PYTHON]  {len(records)} ", file=sys.stderr)
    if records:
        print(f"[PYTHON] : {records[0]}", file=sys.stderr)
        print(f"[PYTHON] : {records[-1]}", file=sys.stderr)
    
    if not records:
        return {'error': 'No records provided'}
    
    return edit_pdf(input_path, output_path, records, site)


def main():
    """Main function for CLI usage."""
    if len(sys.argv) < 4:
        print(json.dumps({'error': 'Usage: python pdf_editor.py <input_pdf> <output_pdf> <json_or_file>'}))
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    json_arg = sys.argv[3]
    
    try:
        # JSON
        if json_arg.startswith('{') or json_arg.startswith('['):
            # JSON
            modifications = json.loads(json_arg)
        else:
            # file or JSON 
            try:
                with open(json_arg, 'r', encoding='utf-8') as f:
                    modifications = json.load(f)
            except (FileNotFoundError, IOError):
                # file or JSON JSON
                modifications = json.loads(json_arg)
        
        result = modify_pdf_precise(input_path, output_path, modifications)
        print(json.dumps(result))
    except json.JSONDecodeError as e:
        print(json.dumps({'error': 'Invalid JSON: ' + str(e)}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': 'Error: ' + str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
