import sys
from xml.sax.saxutils import quoteattr as q
def sms(**k):
    base=dict(protocol="0",address="+15551230001",date="1600000000000",type="1",subject="null",body="hi",toa="null",sc_toa="null",service_center="null",read="1",status="-1",locked="0",date_sent="0",sub_id="-1",readable_date="x",contact_name="(Unknown)")
    base.update(k); base={a:b for a,b in base.items() if b is not None}
    return "<sms "+" ".join(f"{a}={q(b)}" for a,b in base.items())+" />"
def mms(parts="",addrs="",**k):
    base=dict(date="1600000100000",msg_box="1",address="+15551230001",sub="null",ct_t="application/vnd.wap.multipart.related",read="1",m_id="mid1",m_size="123",m_type="132",rr="129",read_status="null",sim_slot="0",thread_id="5",readable_date="x",contact_name="Bob")
    base.update(k); base={a:b for a,b in base.items() if b is not None}
    at=" ".join(f"{a}={q(b)}" for a,b in base.items())
    return f"<mms {at}><parts>{parts}</parts><addrs>{addrs}</addrs></mms>"
def part(ct,**k): return "<part "+f"ct={q(ct)} "+" ".join(f"{a}={q(b)}" for a,b in k.items())+" />"
def addr(a,t): return f"<addr address={q(a)} type={q(str(t))} charset=\"106\" />"
rows=[
 sms(), sms(),                                   # exact duplicate in-file
 sms(address="(555) 123-4567",body="  padded  body ",date="1600000001000",subject="  Hi  "),
 sms(address="5551234567",date="1600000002000",type="2"),
 sms(address="15551234567",date="1600000003000"),
 sms(address="+44 20 7946 0958",date="1600000004000",body="🎉 emoji ünï"),
 sms(address="",date="1600000005000"),
 sms(address="12345",date="1600000006000",status=None,sub_id=None,protocol=None),   # missing attrs
 sms(address="+15551230002",date="1600000007000",type="x",read=None,thread_id="zz"),
 sms(address="+15551230003",date="abc"),         # unparseable date -> skipped
 sms(address="+15551230004",date="1600000008500",service_center="+13125551212",subject="NULL",contact_name=None),
 sms(address="+15551230005",date="-1500",body="negative date"),
 mms(parts=part("application/smil",text="<smil/>")+part("text/plain",text="hello  there ")+part("text/plain",text="null")+part("text/plain",text=" world"),
     addrs=addr("+15551230001",137)+addr("(555) 123-0009",151)),
 mms(date="1600000200000",parts=part("image/jpeg",data="aGVsbG8=",text="null")+part("image/png",data="d29ybGQ="),
     addrs=addr("+15551230001",137)+addr("+15551230002",151)+addr("+15551230003",151),m_id="mid2"),
 mms(date="1600000300000",parts=part("image/jpeg",data="@@@not-b64")+part("image/png",data="d29ybGQ="),addrs=addr("+15551230001",137),m_id="mid3"),
 mms(date="1600000400000",parts=part("text/x-vcard",data="QkVHSU46VkNBUkQ=",text="null"),addrs=addr("+15551230001",137),m_id="mid4"),
 mms(date="1600000500000",ct_t="",parts=part("text/plain",text="no ct_t"),addrs=addr("+15551230001",137),m_id="mid5"),
 mms(date="1600000600000",address="",parts=part("text/plain",text="no top address"),addrs=addr("+15551230007",137)+addr("+15551230008",151),m_id="mid6",msg_box="2"),
 mms(date="1600000700000",parts=part("text/plain",text="no addrs"),addrs="",m_id="mid7",sub="  Subj ",rr=None,m_size="zz"),
 mms(date="1600000800000",parts=part("text/plain",text="recv no137"),addrs=addr("+15551230011",151)+addr("+15551230010",151),m_id="mid8"),
 mms(date="1600000900000",parts=part("video/mp4",data="AAAA",text="null")+part("image/gif",data="R0lG"),addrs=addr("+15551230001",137),m_id=""),
 mms(date="bad",parts="",addrs="",m_id="x"),
]
calls=[
 '<call number="(555) 123-4567" duration="30" date="1600001000000" type="1" presentation="1" subscription_id="abc" readable_date="x" contact_name="(Unknown)" />',
 '<call number="+15551230001" date="1600001100000" type="3" />',
 '<call number="+15551230001" date="oops" type="3" />',
]
open(sys.argv[1],"w").write('<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\' ?>\n<smses count="%d">\n%s\n%s\n</smses>\n'%(len(rows),"\n".join(rows),"\n".join(calls)))
