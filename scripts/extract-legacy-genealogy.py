#!/usr/bin/env python3
"""Extract relation-table and tree-map structure from an explicitly supplied legacy site."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
import hashlib, json, posixpath, re, sys

VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}

class Node:
    def __init__(self, tag, attrs, parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children, self.content = [], []
        if parent:
            parent.children.append(self); parent.content.append(self)
    def text(self): return ''.join(x if isinstance(x,str) else x.text() for x in self.content)

class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.root=Node('root',[]); self.stack=[self.root]
    def handle_starttag(self, tag, attrs):
        if tag == 'br': self.stack[-1].content.append('\ue000'); return
        node=Node(tag,attrs,self.stack[-1])
        if tag not in VOID: self.stack.append(node)
    def handle_startendtag(self, tag, attrs): Node(tag,attrs,self.stack[-1])
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag == tag: self.stack=self.stack[:i]; break
    def handle_data(self, data): self.stack[-1].content.append(data)

def all_nodes(node, tag):
    result=[]
    for child in node.children:
        if child.tag == tag: result.append(child)
        result.extend(all_nodes(child,tag))
    return result

def norm(s): return re.sub(r'\s+',' ',s).strip()
def target_path(href, page_path):
    if not href or href.startswith(('mailto:','#')) or re.match(r'^(?:https?:)?//',href,re.I): return None
    q=parse_qs(urlparse(href).query)
    if 'url' in q:
        m=re.search(r'zaniratti\.it[:/](.*)$',q['url'][0],re.I)
        if not m: return None
        href=unquote(m.group(1))
    href=unquote(href.strip()).replace('\\','/')
    if href.startswith('../'): href=href[3:]
    elif href.startswith('./'): href=href[2:]
    if href.startswith('/'): href=href[1:]
    elif not href.startswith(('BRA/','ITA/','Esposito/','Murucci/','Foto/','Mini/','FO/')) and not href.startswith(posixpath.dirname(page_path).split('/')[0]+'/'):
        href=posixpath.normpath(posixpath.join(posixpath.dirname(page_path),href))
    return href if re.search(r'\.(?:htm|html|gif|jpe?g|png)$',href,re.I) else None

def linked_lines(cell, page_path):
    lines=[{'text_parts':[],'names':[]}]
    def walk(node):
        for x in node.content:
            if isinstance(x,str):
                parts=x.split('\ue000')
                if parts[0]: lines[-1]['text_parts'].append(parts[0])
                for piece in parts[1:]: lines.append({'text_parts':[piece] if piece else [],'names':[]})
            elif x.tag=='a':
                label=norm(x.text()); href=x.attrs.get('href','')
                if label: lines[-1]['names'].append({'label':label,'target':target_path(href,page_path),'linked':bool(target_path(href,page_path))})
            else: walk(x)
    walk(cell)
    output=[]
    for line in lines:
        literal=norm(' '.join(line['text_parts']))
        linked_labels={norm(x['label']).casefold() for x in line['names']}
        names=list(line['names'])
        if literal and literal.casefold() not in linked_labels and literal not in {'X','?','-'}:
            names.append({'label':literal,'target':None,'linked':False})
        if names: output.extend(names)
    return output

def profile_table(root):
    for table in all_nodes(root,'table'):
        rows=[]
        for tr in [x for x in table.children if x.tag=='tr']:
            cells=[x for x in tr.children if x.tag in {'td','th'}]
            if cells: rows.append(cells)
        if not rows: continue
        heads=' '.join(norm(c.text()).casefold() for c in rows[0])
        if len(rows[0])>=5 and any(s in heads for s in ('pais','genitori')) and any(s in heads for s in ('filhos','figli')):
            return rows
    return None

def main():
    if len(sys.argv)!=2: raise SystemExit('uso: extract-legacy-genealogy.py SITE_ROOT')
    root=Path(sys.argv[1]).resolve()
    if not root.is_dir(): raise SystemExit('SITE_ROOT não é diretório')
    pages=[]; by_path={}
    for f in sorted(root.rglob('*')):
        if not f.is_file() or f.suffix.lower() not in {'.htm','.html'}: continue
        raw=f.read_bytes(); text=raw.decode('utf-8','replace'); parser=Parser(); parser.feed(text)
        rel=f.relative_to(root).as_posix(); title=next((norm(x.text()) for x in all_nodes(parser.root,'title')), '')
        meta=next((x.attrs.get('content','') for x in all_nodes(parser.root,'meta') if x.attrs.get('name','').lower()=='description'),'')
        rows=profile_table(parser.root); relations=[]
        if rows and len(rows)>1:
            for role, idx in [('parent',1),('sibling',2),('spouse',3),('child',4)]:
                if idx>=len(rows[1]): continue
                values=linked_lines(rows[1][idx],rel)
                if role=='sibling': values=[x for x in values if not x['label'].startswith('>') and not x['label'].endswith('<')]
                # The Antonio 1846 page combines two explicitly named spouses
                # in one legacy table cell. Preserve them as distinct people.
                if rel == 'BRA/Antonio1846B.htm' and role == 'spouse':
                    values=[{'label':'Angelica Braga','target':None,'linked':False},{'label':'Flora Salani','target':None,'linked':False}]
                # Some legacy child cells append a row of dates after the names;
                # those numeric annotations are not additional children.
                if role == 'child': values=[x for x in values if re.search(r'[A-Za-zÀ-ÿ]',x['label'])]
                relations.append({'role':role,'names':values})
        areas=[]; images=[]
        for area in all_nodes(parser.root,'area'):
            href=area.attrs.get('href','')
            areas.append({'label':norm(area.attrs.get('alt','')),'target':target_path(href,rel),'coords':area.attrs.get('coords','')})
        for image in all_nodes(parser.root,'img'):
            src=image.attrs.get('src','')
            images.append({'target':target_path(src,rel),'alt':norm(image.attrs.get('alt','')),'src':src})
        is_map=len(areas)>=6 and any(w in (rel+' '+title+' '+meta).casefold() for w in ('albero','árvore','genealog'))
        pages.append({'path':rel,'sha256':hashlib.sha256(raw).hexdigest(),'title':title,'description':norm(meta),'relations':relations,'tree_map':is_map,'map_nodes':areas if is_map else [],'images':images})
        by_path[rel.casefold()]=True
    print(json.dumps({'pages':pages,'source_page_count':len(pages),'profile_page_count':sum(bool(x['relations']) for x in pages),'tree_map_count':sum(x['tree_map'] for x in pages),'recovered_page_count':len(by_path)},ensure_ascii=False,separators=(',',':')))

if __name__=='__main__': main()
